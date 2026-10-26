import { MelhorEnvioError, type MelhorEnvioParty, type MelhorEnvioShipmentInput } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { decryptPII } from "@curtiz/security/pii";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createMelhorEnvioProvider, type MelhorEnvioRuntimeEnvironment } from "./melhor-envio-server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "./unknown-data";
import { melhorEnvioStatusTransition } from "./melhor-envio-webhook";

type ShippingJobEnvironment = MelhorEnvioRuntimeEnvironment & {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PII_ENCRYPTION_KEY?: string;
  BLING_REQUIRE_INVOICE_FOR_SHIPPING?: string;
  BLING_CLIENT_ID?: string;
  MELHOR_ENVIO_HOMOLOGATION_SHIPMENT_ID?: string;
};

type ServiceDatabase = Parameters<typeof createMelhorEnvioProvider>[1];
type Job = { id: string; jobType: "melhorenvio.create" | "melhorenvio.cancel" | "melhorenvio.purchase" | "melhorenvio.generate" | "melhorenvio.sync"; shipmentId: string };
const records = (value: unknown) => Array.isArray(value) ? value.filter(isUnknownRecord) : [];

const serviceDatabase = (environment: ShippingJobEnvironment, transport: typeof fetch): ServiceDatabase | null => {
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  try {
    const url = new URL(environment.SUPABASE_URL?.trim() ?? "");
    if (!secret || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return createClient(url.origin, secret, { global: { fetch: transport }, auth: { autoRefreshToken: false, persistSession: false } }) as ServiceDatabase;
  } catch { return null; }
};

const originParty = (environment: ShippingJobEnvironment): MelhorEnvioParty => {
  const value = (name: string) => environment[name]?.trim() ?? "";
  const digits = (name: string) => value(name).replace(/\D/gu, "");
  const document = digits("MELHOR_ENVIO_ORIGIN_DOCUMENT");
  const companyDocument = digits("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
  const required = [value("MELHOR_ENVIO_ORIGIN_NAME"), value("MELHOR_ENVIO_ORIGIN_EMAIL"), digits("MELHOR_ENVIO_ORIGIN_PHONE"),
    value("MELHOR_ENVIO_ORIGIN_ADDRESS"), value("MELHOR_ENVIO_ORIGIN_NUMBER"), value("MELHOR_ENVIO_ORIGIN_DISTRICT"),
    value("MELHOR_ENVIO_ORIGIN_CITY"), value("MELHOR_ENVIO_ORIGIN_STATE"), digits("MELHOR_ENVIO_ORIGIN_POSTAL_CODE"),
    document || companyDocument];
  if (value("MELHOR_ENVIO_ORIGIN_CITY").toLocaleLowerCase("pt-BR") !== "nova serrana" || value("MELHOR_ENVIO_ORIGIN_STATE").toUpperCase() !== "MG"
    || required.some((item) => !item) || !/^\d{10,11}$/u.test(digits("MELHOR_ENVIO_ORIGIN_PHONE"))
    || !/^\d{8}$/u.test(digits("MELHOR_ENVIO_ORIGIN_POSTAL_CODE")) || !/^[A-Za-z]{2}$/u.test(value("MELHOR_ENVIO_ORIGIN_STATE"))
    || document && !/^\d{11}$/u.test(document) || companyDocument && !/^\d{14}$/u.test(companyDocument)) {
    throw new MelhorEnvioError("configuration", 503, false);
  }
  return { name: value("MELHOR_ENVIO_ORIGIN_NAME"), email: value("MELHOR_ENVIO_ORIGIN_EMAIL"),
    phone: digits("MELHOR_ENVIO_ORIGIN_PHONE"), address: value("MELHOR_ENVIO_ORIGIN_ADDRESS"),
    number: value("MELHOR_ENVIO_ORIGIN_NUMBER"), complement: value("MELHOR_ENVIO_ORIGIN_COMPLEMENT"),
    district: value("MELHOR_ENVIO_ORIGIN_DISTRICT"), city: value("MELHOR_ENVIO_ORIGIN_CITY"),
    postal_code: digits("MELHOR_ENVIO_ORIGIN_POSTAL_CODE"), state_abbr: value("MELHOR_ENVIO_ORIGIN_STATE").toUpperCase(),
    ...(companyDocument ? { company_document: companyDocument,
      ...(value("MELHOR_ENVIO_ORIGIN_STATE_REGISTER") ? { state_register: value("MELHOR_ENVIO_ORIGIN_STATE_REGISTER") } : {}),
      ...(value("MELHOR_ENVIO_ORIGIN_CNAE") ? { economic_activity_code: value("MELHOR_ENVIO_ORIGIN_CNAE") } : {}) }
      : { document }) };
};

const readJob = (value: unknown): Job | null => {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.payload)) return null;
  const id = readString(value, "id");
  const jobType = readString(value, "jobType");
  const shipmentId = readString(value.payload, "shipmentId");
  return id && shipmentId && ["melhorenvio.create", "melhorenvio.cancel", "melhorenvio.purchase", "melhorenvio.generate", "melhorenvio.sync"].includes(jobType)
    ? { id, shipmentId, jobType: jobType as Job["jobType"] } : null;
};

async function shippingClearance(db: ServiceDatabase, orderId: string): Promise<string> {
  const [orderResult, linkResult] = await Promise.all([
    db.from("orders").select("status,payment_status").eq("id", orderId).maybeSingle(),
    db.rpc("read_bling_order_link", { p_order_id: orderId })
  ]);
  const order = isUnknownRecord(orderResult.data) ? orderResult.data : null;
  const link = isUnknownRecord(linkResult.data) ? linkResult.data : null;
  if (orderResult.error || linkResult.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
  if (!order || order.payment_status !== "approved" || !["payment_approved", "processing", "picking", "ready_to_ship", "shipped"].includes(readString(order, "status")))
    throw new MelhorEnvioError("conflict", 409, false);
  const key = link ? readString(link, "invoice_access_key") : "";
  if (link?.invoice_status !== "authorized" || link?.erp_status !== "synced" || !/^\d{44}$/u.test(key))
    throw new MelhorEnvioError("fiscal_shipping_blocked", 409, true);
  return key;
}

async function createShipment(db: ServiceDatabase, environment: ShippingJobEnvironment, shipmentId: string, transport: typeof fetch) {
  const result = readQueryResult(await db.from("shipments")
    .select("id,order_id,external_id,operation_state,shipping_quote_id,package_snapshot,metadata_sanitized")
    .eq("id", shipmentId).eq("provider", "melhorenvio").maybeSingle());
  if (!isUnknownRecord(result.data)) throw new MelhorEnvioError("not_found", 404, false);
  const shipment = result.data;
  if (readString(shipment, "external_id")) return;
  let fiscalKey: string;
  try { fiscalKey = await shippingClearance(db, readString(shipment, "order_id")); }
  catch (error) {
    if (error instanceof MelhorEnvioError && error.code === "fiscal_shipping_blocked") {
      await db.from("shipments").update({ operation_state: "awaiting_invoice", last_error_code: "fiscal_shipping_blocked" })
        .eq("id", shipmentId).in("operation_state", ["pending", "failed"]);
    }
    throw error;
  }
  const claimed = readQueryResult(await db.from("shipments").update({ operation_state: "creating", updated_at: new Date().toISOString() })
    .eq("id", shipmentId).in("operation_state", ["pending", "failed", "awaiting_invoice"]).select("id").maybeSingle());
  if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
  let writeStarted = false;
  let acknowledged = false;
  try {
    const orderId = readString(shipment, "order_id");
    const [orderResult, itemsResult, quoteResult] = await Promise.all([
      db.from("orders").select("status,payment_status,customer_id,customer_name_snapshot,customer_email_snapshot,customer_phone_snapshot,shipping_address_snapshot,public_code")
        .eq("id", orderId).maybeSingle(),
      db.from("order_items").select("variant_id,product_name_snapshot,quantity,unit_price").eq("order_id", orderId),
      db.from("shipping_quotes").select("service_id,provider_environment").eq("id", readString(shipment, "shipping_quote_id")).maybeSingle()
    ]);
    const order = isUnknownRecord(orderResult.data) ? orderResult.data : null;
    const quote = isUnknownRecord(quoteResult.data) ? quoteResult.data : null;
    if (orderResult.error || itemsResult.error || quoteResult.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
    if (!order || !quote || order.payment_status !== "approved" || readString(quote, "provider_environment") !== environment.MELHOR_ENVIO_ENVIRONMENT
      || ["manual_review", "cancellation_requested", "cancelled", "refund_pending", "refunded"].includes(readString(order, "status"))) {
      throw new MelhorEnvioError("conflict", 409, false);
    }
    const identity = readQueryResult(await db.rpc("get_customer_checkout_identity", { p_customer_id: readString(order, "customer_id") }));
    const address = isUnknownRecord(order.shipping_address_snapshot) ? order.shipping_address_snapshot : null;
    const cpf = isUnknownRecord(identity.data)
      ? decryptPII(readString(identity.data, "cpfCiphertext"), environment.PII_ENCRYPTION_KEY) : "";
    const allProducts = records(itemsResult.data).map((item) => ({ id: readString(item, "variant_id"),
      name: readString(item, "product_name_snapshot").slice(0, 255), quantity: readNumber(item, "quantity"),
      unitary_value: readNumber(item, "unit_price") }));
    const packageSnapshot = records(shipment.package_snapshot);
    const packageProducts = packageSnapshot.length === 1 && isUnknownRecord(packageSnapshot[0])
      ? records(packageSnapshot[0].products) : [];
    const metadata = isUnknownRecord(shipment.metadata_sanitized) ? shipment.metadata_sanitized : null;
    const selectedProducts = packageProducts.length ? packageProducts.map((reference) => {
      const source = allProducts.find((item) => item.id === readString(reference, "id"));
      const quantity = readNumber(reference, "quantity");
      return source && Number.isInteger(quantity) && quantity > 0 && quantity <= source.quantity
        ? { ...source, quantity } : null;
    }).filter((item): item is NonNullable<typeof item> => item !== null) : metadata?.separateVolume === true ? [] : allProducts;
    const products = selectedProducts.map(({ name, quantity, unitary_value }) => ({ name, quantity, unitary_value }));
    const volumes = packageSnapshot.map((item) => {
      const dimensions = isUnknownRecord(item.dimensions) ? item.dimensions : null;
      return { height: dimensions ? readNumber(dimensions, "height") : 0, width: dimensions ? readNumber(dimensions, "width") : 0,
        length: dimensions ? readNumber(dimensions, "length") : 0, weight: readNumber(item, "weight") };
    });
    if (!address || !/^\d{11}$/u.test(cpf) || !products.length || products.some((item) => !item.name || item.quantity <= 0 || item.unitary_value <= 0)
      || !volumes.length || volumes.some(item => Object.values(item).some(value => !Number.isFinite(value) || value <= 0))
      || (packageProducts.length > 0 && selectedProducts.length !== packageProducts.length)
      || new Set(selectedProducts.map(item => item.id)).size !== selectedProducts.length) throw new MelhorEnvioError("validation", 409, false);
    const to: MelhorEnvioParty = { name: readString(order, "customer_name_snapshot"), email: readString(order, "customer_email_snapshot"),
      phone: readString(order, "customer_phone_snapshot").replace(/\D/gu, ""), document: cpf,
      address: readString(address, "street"), complement: readString(address, "complement"), number: readString(address, "number"),
      district: readString(address, "district"), city: readString(address, "city"),
      postal_code: (readString(address, "postalCode") || readString(address, "postal_code")).replace(/\D/gu, ""), state_abbr: readString(address, "state").toUpperCase(), country_id: "BR" };
    if ([to.name, to.address, to.number, to.district, to.city].some(value => !value.trim())
      || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(to.email) || !/^\d{10,11}$/u.test(to.phone)
      || !/^\d{8}$/u.test(to.postal_code) || !/^[A-Z]{2}$/u.test(to.state_abbr)) throw new MelhorEnvioError("validation", 409, false);
    const input: MelhorEnvioShipmentInput = { serviceId: readString(quote, "service_id"), from: originParty(environment), to, products, volumes,
      options: { platform: environment.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
        insurance_value: products.reduce((total, item) => total + item.quantity * item.unitary_value, 0), receipt: false,
        own_hand: false, reverse: false, ...(fiscalKey ? { invoice: { key: fiscalKey } } : {}),
        tags: [{ tag: readString(order, "public_code"), url: null }] } };
    const provider = createMelhorEnvioProvider(environment, db, transport);
    await shippingClearance(db, orderId);
    writeStarted = true;
    const created = await provider.createShipment(input);
    acknowledged = true;
    const saved = readQueryResult(await db.from("shipments").update({ external_id: created.externalId, operation_state: "created",
      last_error_code: null, updated_at: new Date().toISOString() }).eq("id", shipmentId).eq("operation_state", "creating")
      .select("id").maybeSingle());
    if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
  } catch (error) {
    const uncertain = acknowledged || (error instanceof MelhorEnvioError ? error.code === "uncertain_write" : writeStarted);
    await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : "failed",
      last_error_code: error instanceof MelhorEnvioError ? error.code : "operation_failed", updated_at: new Date().toISOString() })
      .eq("id", shipmentId).eq("operation_state", "creating");
    throw uncertain ? new MelhorEnvioError("uncertain_write", 503, false) : error;
  }
}

async function cancelShipment(db: ServiceDatabase, environment: ShippingJobEnvironment, shipmentId: string, transport: typeof fetch) {
  const result = readQueryResult(await db.from("shipments").select("external_id,operation_state")
    .eq("id", shipmentId).eq("provider", "melhorenvio").maybeSingle());
  if (!isUnknownRecord(result.data)) throw new MelhorEnvioError("not_found", 404, false);
  const externalId = readString(result.data, "external_id");
  const state = readString(result.data, "operation_state");
  if (state === "cancelled") return;
  if (!externalId || !["created", "purchased", "generated"].includes(state)) throw new MelhorEnvioError("conflict", 409, false);
  if (state === "created") {
    const saved = await db.from("shipments").update({ operation_state: "cancelled", status: "cancelled" })
      .eq("id", shipmentId).eq("operation_state", "created").select("id").maybeSingle();
    if (saved.error || !saved.data) throw new MelhorEnvioError("conflict", 409, false);
    return;
  }
  const provider = createMelhorEnvioProvider(environment, db, transport);
  if (!(await provider.isCancellable(externalId))) throw new MelhorEnvioError("conflict", 409, false);
  const claimed = readQueryResult(await db.from("shipments").update({ operation_state: "cancelling", updated_at: new Date().toISOString() })
    .eq("id", shipmentId).in("operation_state", ["purchased", "generated"]).select("id").maybeSingle());
  if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
  let acknowledged = false;
  try {
    await provider.cancel(externalId, "Cancelamento do pedido");
    acknowledged = true;
    const remote = await provider.getShipment(externalId);
    if (!["cancelled", "canceled"].includes(readString(remote, "status").toLowerCase())) throw new MelhorEnvioError("uncertain_write", 503, false);
    const saved = readQueryResult(await db.from("shipments").update({ operation_state: "cancelled", status: "cancelled",
      last_error_code: null, updated_at: new Date().toISOString() }).eq("id", shipmentId).eq("operation_state", "cancelling")
      .select("id").maybeSingle());
    if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
  } catch (error) {
    const uncertain = acknowledged || !(error instanceof MelhorEnvioError) || error.code === "uncertain_write";
    await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : state,
      last_error_code: error instanceof MelhorEnvioError ? error.code : "operation_failed", updated_at: new Date().toISOString() })
      .eq("id", shipmentId).eq("operation_state", "cancelling");
    throw uncertain ? new MelhorEnvioError("uncertain_write", 503, false) : error;
  }
}

async function advanceShipment(db: ServiceDatabase, environment: ShippingJobEnvironment, job: Job, transport: typeof fetch) {
  const result = await db.from("shipments").select("order_id,external_id,operation_state,status,shipping_quote_id")
    .eq("id", job.shipmentId).eq("provider", "melhorenvio").maybeSingle();
  if (result.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
  const shipment = isUnknownRecord(result.data) ? result.data : null;
  const externalId = shipment ? readString(shipment, "external_id") : "";
  if (!shipment || !externalId) throw new MelhorEnvioError("conflict", 409, false);
  const provider = createMelhorEnvioProvider(environment, db, transport);
  if (job.jobType === "melhorenvio.sync") {
    const remote = await provider.getShipment(externalId);
    const remoteStatus = readString(remote, "status").toLowerCase();
    const normalized = melhorEnvioStatusTransition("", `order.${remoteStatus}`, remoteStatus);
    if (!normalized) throw new MelhorEnvioError("invalid_response", 502, true);
    const timestamp = readString(remote, `${remoteStatus}_at`) || readString(remote, "updated_at") || readString(remote, "created_at");
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new MelhorEnvioError("invalid_response", 502, true);
    const observed = { externalId, status: remoteStatus, occurredAt: new Date(timestamp).toISOString(),
      tracking: readString(remote, "tracking") || readString(remote, "self_tracking") };
    const hash = createHash("sha256").update(JSON.stringify(observed)).digest("hex");
    const applied = await db.rpc("apply_melhor_envio_webhook", { p_event_key: `poll:${hash}`, p_payload_hash: hash,
      p_event_type: `order.${remoteStatus}`, p_external_id: externalId, p_status: normalized.status,
      p_occurred_at: observed.occurredAt, p_tracking_code: observed.tracking || null });
    if (applied.error || !["processed", "duplicate"].includes(String(applied.data))) throw new MelhorEnvioError("provider_unavailable", 503, true);
    return;
  }
  const purchase = job.jobType === "melhorenvio.purchase";
  if (purchase && environment.MELHOR_ENVIO_LABEL_PURCHASE_ENABLED !== "true"
    || !purchase && environment.MELHOR_ENVIO_LABEL_GENERATION_ENABLED !== "true"
    || environment.MELHOR_ENVIO_ENVIRONMENT === "production" && environment.MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED !== "true")
    throw new MelhorEnvioError("configuration", 503, false);
  const state = readString(shipment, "operation_state");
  if (purchase && ["purchased", "generated", "posted", "delivered"].includes(state)
    || !purchase && ["generated", "posted", "delivered"].includes(state)) return;
  const expected = purchase ? "created" : "purchased";
  const busy = purchase ? "purchasing" : "generating";
  if (state !== expected) throw new MelhorEnvioError("conflict", 409, false);
  await shippingClearance(db, readString(shipment, "order_id"));
  const quote = await db.from("shipping_quotes").select("provider_environment").eq("id", readString(shipment, "shipping_quote_id")).maybeSingle();
  if (quote.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
  if (!isUnknownRecord(quote.data) || quote.data.provider_environment !== environment.MELHOR_ENVIO_ENVIRONMENT)
    throw new MelhorEnvioError("conflict", 409, false);
  const claimed = await db.from("shipments").update({ operation_state: busy, updated_at: new Date().toISOString() })
    .eq("id", job.shipmentId).eq("operation_state", expected).select("id").maybeSingle();
  if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
  let writeStarted = false;
  let acknowledged = false;
  try {
    await shippingClearance(db, readString(shipment, "order_id"));
    writeStarted = true;
    if (purchase) await provider.purchase([externalId]);
    else await provider.generate([externalId]);
    acknowledged = true;
    const remote = await provider.getShipment(externalId);
    const generated = readString(remote, "status").toLowerCase() === "generated";
    if (!(purchase ? ["paid", "released", "generated"] : ["generated"]).includes(readString(remote, "status").toLowerCase()))
      throw new MelhorEnvioError("uncertain_write", 503, false);
    const saved = await db.from("shipments").update({ operation_state: generated ? "generated" : "purchased",
      ...(generated ? { status: "label_created", label_path: `private:${externalId}` } : {}),
      last_error_code: null, updated_at: new Date().toISOString() }).eq("id", job.shipmentId).eq("operation_state", busy).select("id").maybeSingle();
    if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
  } catch (error) {
    const uncertain = acknowledged || (error instanceof MelhorEnvioError ? error.code === "uncertain_write" : writeStarted);
    await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : expected,
      last_error_code: uncertain ? "uncertain_write" : error instanceof MelhorEnvioError ? error.code : "operation_failed" })
      .eq("id", job.shipmentId).eq("operation_state", busy);
    throw uncertain ? new MelhorEnvioError("uncertain_write", 503, false) : error;
  }
}

export async function runMelhorEnvioShippingJobs(environment: ShippingJobEnvironment, executionId: string, limit = 5, transport: typeof fetch = fetch) {
  const targetShipmentId = environment.MELHOR_ENVIO_HOMOLOGATION_SHIPMENT_ID;
  if (targetShipmentId !== undefined && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(targetShipmentId)
    || environment.MELHOR_ENVIO_ENVIRONMENT !== "sandbox"
    || environment.MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED === "true")) return { ok: false, processed: 0, failed: 0 };
  const db = serviceDatabase(environment, transport);
  if (!db) return { ok: false, processed: 0, failed: 0 };
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 10); index += 1) {
    const lockId = crypto.randomUUID();
    const liveAllowed = environment.MELHOR_ENVIO_ENVIRONMENT !== "production" || environment.MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED === "true";
    const claim = readQueryResult(await db.rpc(targetShipmentId ? "claim_melhor_envio_shipment_job" : "claim_melhor_envio_fulfillment_job", { p_lock_id: lockId,
      ...(targetShipmentId ? { p_shipment_id: targetShipmentId } : {}),
      p_purchase_enabled: liveAllowed && environment.MELHOR_ENVIO_LABEL_PURCHASE_ENABLED === "true",
      p_generation_enabled: liveAllowed && environment.MELHOR_ENVIO_LABEL_GENERATION_ENABLED === "true" }));
    const job = readJob(claim.data);
    if (claim.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
    if (targetShipmentId && claim.data && (!job || job.shipmentId !== targetShipmentId || job.jobType === "melhorenvio.cancel")) {
      logServerEvent("error", "shipping_homologation_scope_mismatch", { executionId });
      return { ok: false, processed, failed: failed + 1 };
    }
    if (!job) break;
    try {
      if (job.jobType === "melhorenvio.create") await createShipment(db, environment, job.shipmentId, transport);
      else if (job.jobType === "melhorenvio.cancel") await cancelShipment(db, environment, job.shipmentId, transport);
      else await advanceShipment(db, environment, job, transport);
      const finished = readQueryResult(await db.rpc("finish_melhor_envio_job", {
        p_job_id: job.id, p_lock_id: lockId, p_success: true, p_error_code: null
      }));
      if (finished.error || finished.data !== true) throw new MelhorEnvioError("provider_unavailable", 503, false);
      processed += 1;
    } catch (error) {
      failed += 1;
      await db.rpc("finish_melhor_envio_job", { p_job_id: job.id, p_lock_id: lockId, p_success: false,
        p_error_code: error instanceof MelhorEnvioError ? error.code : "shipping_job_failed" });
    }
  }
  logServerEvent(failed ? "error" : "info", "melhor_envio_shipping_jobs_completed", { executionId, processed, failed });
  return { ok: failed === 0, processed, failed };
}
