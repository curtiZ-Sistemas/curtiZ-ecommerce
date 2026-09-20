import { MelhorEnvioError, type MelhorEnvioParty, type MelhorEnvioShipmentInput } from "@curtiz/integrations";
import { logServerEvent } from "@curtiz/security";
import { decryptPII } from "@curtiz/security/pii";
import { createClient } from "@supabase/supabase-js";
import { createMelhorEnvioProvider, type MelhorEnvioRuntimeEnvironment } from "./melhor-envio-server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "./unknown-data";

type ShippingJobEnvironment = MelhorEnvioRuntimeEnvironment & {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PII_ENCRYPTION_KEY?: string;
};

type ServiceDatabase = Parameters<typeof createMelhorEnvioProvider>[1];
type Job = { id: string; jobType: "melhorenvio.create" | "melhorenvio.cancel"; shipmentId: string };
const records = (value: unknown) => Array.isArray(value) ? value.filter(isUnknownRecord) : [];

const serviceDatabase = (environment: ShippingJobEnvironment): ServiceDatabase | null => {
  const secret = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  try {
    const url = new URL(environment.SUPABASE_URL?.trim() ?? "");
    if (!secret || url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return createClient(url.origin, secret, { auth: { autoRefreshToken: false, persistSession: false } }) as ServiceDatabase;
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
  if (required.some((item) => !item) || !/^\d{10,11}$/u.test(digits("MELHOR_ENVIO_ORIGIN_PHONE"))
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
  return id && shipmentId && ["melhorenvio.create", "melhorenvio.cancel"].includes(jobType)
    ? { id, shipmentId, jobType: jobType as Job["jobType"] } : null;
};

async function createShipment(db: ServiceDatabase, environment: ShippingJobEnvironment, shipmentId: string) {
  const result = readQueryResult(await db.from("shipments")
    .select("id,order_id,external_id,operation_state,shipping_quote_id,package_snapshot,metadata_sanitized")
    .eq("id", shipmentId).eq("provider", "melhorenvio").maybeSingle());
  if (!isUnknownRecord(result.data)) throw new MelhorEnvioError("not_found", 404, false);
  const shipment = result.data;
  if (readString(shipment, "external_id")) return;
  const claimed = readQueryResult(await db.from("shipments").update({ operation_state: "creating", updated_at: new Date().toISOString() })
    .eq("id", shipmentId).in("operation_state", ["pending", "failed"]).select("id").maybeSingle());
  if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
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
    if (!order || !quote || order.payment_status !== "approved" || readString(quote, "provider_environment") !== "sandbox"
      || environment.MELHOR_ENVIO_ENVIRONMENT === "production"
      || ["cancellation_requested", "cancelled", "refund_pending", "refunded"].includes(readString(order, "status"))) {
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
    }).filter((item) => Object.values(item).every((value) => value > 0));
    if (!address || !/^\d{11}$/u.test(cpf) || !products.length || products.some((item) => !item.name || item.quantity <= 0 || item.unitary_value <= 0)
      || !volumes.length) throw new MelhorEnvioError("validation", 409, false);
    const to: MelhorEnvioParty = { name: readString(order, "customer_name_snapshot"), email: readString(order, "customer_email_snapshot"),
      phone: readString(order, "customer_phone_snapshot").replace(/\D/gu, ""), document: cpf,
      address: readString(address, "street"), complement: readString(address, "complement"), number: readString(address, "number"),
      district: readString(address, "district"), city: readString(address, "city"),
      postal_code: readString(address, "postalCode").replace(/\D/gu, ""), state_abbr: readString(address, "state").toUpperCase(), country_id: "BR" };
    const input: MelhorEnvioShipmentInput = { serviceId: readString(quote, "service_id"), from: originParty(environment), to, products, volumes,
      options: { platform: environment.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
        insurance_value: products.reduce((total, item) => total + item.quantity * item.unitary_value, 0), receipt: false,
        own_hand: false, reverse: false, tags: [{ tag: readString(order, "public_code"), url: null }] } };
    const created = await createMelhorEnvioProvider(environment, db).createShipment(input);
    const saved = readQueryResult(await db.from("shipments").update({ external_id: created.externalId, operation_state: "created",
      last_error_code: null, updated_at: new Date().toISOString() }).eq("id", shipmentId).eq("operation_state", "creating")
      .select("id").maybeSingle());
    if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
  } catch (error) {
    const uncertain = error instanceof MelhorEnvioError && error.code === "uncertain_write";
    await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : "failed",
      last_error_code: error instanceof MelhorEnvioError ? error.code : "operation_failed", updated_at: new Date().toISOString() })
      .eq("id", shipmentId).eq("operation_state", "creating");
    throw error;
  }
}

async function cancelShipment(db: ServiceDatabase, environment: ShippingJobEnvironment, shipmentId: string) {
  const result = readQueryResult(await db.from("shipments").select("external_id,operation_state")
    .eq("id", shipmentId).eq("provider", "melhorenvio").maybeSingle());
  if (!isUnknownRecord(result.data)) throw new MelhorEnvioError("not_found", 404, false);
  const externalId = readString(result.data, "external_id");
  if (!externalId || !["purchased", "generated"].includes(readString(result.data, "operation_state"))) return;
  const provider = createMelhorEnvioProvider(environment, db);
  if (!(await provider.isCancellable(externalId))) throw new MelhorEnvioError("conflict", 409, false);
  const claimed = readQueryResult(await db.from("shipments").update({ operation_state: "cancelling", updated_at: new Date().toISOString() })
    .eq("id", shipmentId).in("operation_state", ["purchased", "generated"]).select("id").maybeSingle());
  if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
  try {
    await provider.cancel(externalId, "Cancelamento do pedido");
    const saved = readQueryResult(await db.from("shipments").update({ operation_state: "cancelled", status: "cancelled",
      last_error_code: null, updated_at: new Date().toISOString() }).eq("id", shipmentId).eq("operation_state", "cancelling")
      .select("id").maybeSingle());
    if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
  } catch (error) {
    const uncertain = error instanceof MelhorEnvioError && error.code === "uncertain_write";
    await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : "failed",
      last_error_code: error instanceof MelhorEnvioError ? error.code : "operation_failed", updated_at: new Date().toISOString() })
      .eq("id", shipmentId).eq("operation_state", "cancelling");
    throw error;
  }
}

export async function runMelhorEnvioShippingJobs(environment: ShippingJobEnvironment, executionId: string, limit = 5) {
  const db = serviceDatabase(environment);
  if (!db) return { ok: false, processed: 0, failed: 0 };
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(Math.max(limit, 1), 10); index += 1) {
    const lockId = crypto.randomUUID();
    const claim = readQueryResult(await db.rpc("claim_melhor_envio_job", { p_lock_id: lockId }));
    const job = readJob(claim.data);
    if (claim.error || !job) break;
    try {
      if (job.jobType === "melhorenvio.create") await createShipment(db, environment, job.shipmentId);
      else await cancelShipment(db, environment, job.shipmentId);
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
