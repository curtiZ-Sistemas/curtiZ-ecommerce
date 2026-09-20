import { isAllowedBrowserRequest, readJsonResponse } from "@curtiz/security";
import { decryptPII } from "@curtiz/security/pii";
import { MelhorEnvioError, type MelhorEnvioParty, type MelhorEnvioShipmentInput } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumePanelMutationBudget, panelRateLimitStatus } from "@/lib/api-rate-limit";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { melhorEnvioEnvironment, melhorEnvioOriginMissingFields, panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.flatMap((item) => row(item) ? [item as Row] : []) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const noStore = { "cache-control": "private, no-store" };
const operationRank: Record<string, number> = { pending: 0, awaiting_invoice: 0, creating: 1, created: 2,
  purchasing: 3, purchased: 4, generating: 5, generated: 6, posted: 7, delivered: 8, cancelled: 9 };
const remoteOperation = (status: string) => ({
  pending: { operation_state: "created", status: "pending" },
  paid: { operation_state: "purchased", status: "ready" },
  released: { operation_state: "purchased", status: "ready" },
  generated: { operation_state: "generated", status: "label_created" },
  posted: { operation_state: "posted", status: "dispatched" },
  in_transit: { operation_state: "posted", status: "in_transit" },
  delivered: { operation_state: "delivered", status: "delivered" },
  canceled: { operation_state: "cancelled", status: "cancelled" },
  cancelled: { operation_state: "cancelled", status: "cancelled" }
} as Record<string, { operation_state: string; status: string }>)[status];
const schema = z.object({ action: z.enum(["create", "purchase", "generate", "preview", "print", "sync", "cancel"]),
  shipmentId: z.string().uuid(), reason: z.string().trim().min(3).max(500).optional() });

const safeOrigin = (request: NextRequest) => isAllowedBrowserRequest(request, new Set([
  process.env.NEXT_PUBLIC_PANEL_URL,
  ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
].filter((value): value is string => Boolean(value))));

async function authorize(request: NextRequest) {
  const client = await createServerSupabaseClient();
  const userResult = client ? await client.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!client || !user || userResult?.error || !(await hasRequiredInternalMfa(client))
    || !(await consumePanelMutationBudget(request, client))) return null;
  const [profile, role] = await Promise.all([
    client.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    client.from("user_roles").select("role").eq("user_id", user.id).in("role", ["operational", "admin", "technical"])
  ]);
  const roleNames = rows(role.data).map((item) => text(item.role));
  const actorRole = (["technical", "admin", "operational"] as const).find((item) => roleNames.includes(item));
  return !profile.error && profile.data?.status === "active" && !role.error && actorRole
    ? { userId: user.id, actorRole } : null;
}

const envParty = (): MelhorEnvioParty => {
  if (melhorEnvioOriginMissingFields().length > 0) throw new MelhorEnvioError("configuration", 503, false);
  const companyDocument = process.env.MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT?.replace(/\D/gu, "") ?? "";
  const document = process.env.MELHOR_ENVIO_ORIGIN_DOCUMENT?.replace(/\D/gu, "") ?? "";
  const party: MelhorEnvioParty = {
    name: process.env.MELHOR_ENVIO_ORIGIN_NAME?.trim() ?? "", email: process.env.MELHOR_ENVIO_ORIGIN_EMAIL?.trim() ?? "",
    phone: process.env.MELHOR_ENVIO_ORIGIN_PHONE?.replace(/\D/gu, "") ?? "", address: process.env.MELHOR_ENVIO_ORIGIN_ADDRESS?.trim() ?? "",
    number: process.env.MELHOR_ENVIO_ORIGIN_NUMBER?.trim() ?? "", complement: process.env.MELHOR_ENVIO_ORIGIN_COMPLEMENT?.trim() ?? "",
    district: process.env.MELHOR_ENVIO_ORIGIN_DISTRICT?.trim() ?? "", city: process.env.MELHOR_ENVIO_ORIGIN_CITY?.trim() ?? "",
    postal_code: process.env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.replace(/\D/gu, "") ?? "",
    state_abbr: process.env.MELHOR_ENVIO_ORIGIN_STATE?.trim().toUpperCase() ?? "",
    ...(companyDocument ? { company_document: companyDocument,
      ...(process.env.MELHOR_ENVIO_ORIGIN_STATE_REGISTER?.trim()
        ? { state_register: process.env.MELHOR_ENVIO_ORIGIN_STATE_REGISTER.trim() } : {}),
      ...(process.env.MELHOR_ENVIO_ORIGIN_CNAE?.trim() ? { economic_activity_code: process.env.MELHOR_ENVIO_ORIGIN_CNAE.trim() } : {}) }
      : { document })
  };
  const required = [party.name,party.email,party.phone,party.address,party.number,party.district,party.city,party.postal_code,party.state_abbr,
    party.document || party.company_document];
  if (required.some((value) => !value)) throw new MelhorEnvioError("configuration", 503, false);
  return party;
};

const operationFailure = async (db: NonNullable<ReturnType<typeof createServiceSupabaseClient>>, shipmentId: string, error: unknown) => {
  const uncertain = error instanceof MelhorEnvioError && error.code === "uncertain_write";
  await db.from("shipments").update({ operation_state: uncertain ? "reconciliation_required" : "failed",
    last_error_code: error instanceof MelhorEnvioError ? error.code : "operation_failed", updated_at: new Date().toISOString() }).eq("id", shipmentId);
};

export async function POST(request: NextRequest) {
  if (!safeOrigin(request)) return NextResponse.json({ ok: false, message: "Origem não autorizada." }, { status: 403, headers: noStore });
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ ok: false, message: "Acesso negado." }, { status: panelRateLimitStatus(request), headers: noStore });
  const body = await readJsonResponse(request, 16 * 1024);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Ação de frete inválida." }, { status: 400, headers: noStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ ok: false, message: "Integração indisponível." }, { status: 503, headers: noStore });
  const shipmentResult = await db.from("shipments").select("id,order_id,provider,service,external_id,status,operation_state,shipping_quote_id,package_snapshot,metadata_sanitized")
    .eq("id", parsed.data.shipmentId).eq("provider", "melhorenvio").maybeSingle();
  const shipment = row(shipmentResult.data);
  if (shipmentResult.error || !shipment) return NextResponse.json({ ok: false, message: "Remessa não encontrada." }, { status: 404, headers: noStore });
  const externalId = text(shipment.external_id);
  const provider = panelMelhorEnvioProvider();
  let claimedOperation = false;
  try {
    let data: Record<string, unknown> = {};
    if (parsed.data.action === "create") {
      if (externalId) return NextResponse.json({ ok: true, data: { externalId } }, { headers: noStore });
      const claimed = await db.from("shipments").update({ operation_state: "creating", updated_at: new Date().toISOString() })
        .eq("id", parsed.data.shipmentId).in("operation_state", ["pending", "awaiting_invoice", "failed"]).select("id").maybeSingle();
      if (claimed.error || !claimed.data) return NextResponse.json({ ok: false, message: "A remessa já está em processamento; sincronize antes de repetir." }, { status: 409, headers: noStore });
      claimedOperation = true;
      const orderId = text(shipment.order_id);
      const [orderResult, itemsResult, quoteResult, invoiceResult] = await Promise.all([
        db.from("orders").select("id,status,payment_status,customer_id,customer_name_snapshot,customer_email_snapshot,customer_phone_snapshot,shipping_address_snapshot,public_code")
          .eq("id", orderId).maybeSingle(),
        db.from("order_items").select("variant_id,product_name_snapshot,quantity,unit_price").eq("order_id", orderId),
        db.from("shipping_quotes").select("service_id,amount").eq("id", text(shipment.shipping_quote_id)).maybeSingle(),
        db.from("erp_documents").select("status,reference").eq("order_id", orderId).eq("document_type", "nfe")
          .eq("status", "authorized").order("updated_at", { ascending: false }).limit(1).maybeSingle()
      ]);
      const order = row(orderResult.data);
      const quote = row(quoteResult.data);
      if (!order || !quote || order.payment_status !== "approved") throw new MelhorEnvioError("conflict", 409, false);
      const identity = await db.rpc("get_customer_checkout_identity", { p_customer_id: text(order.customer_id) });
      const identityRow = row(identity.data);
      const address = row(order.shipping_address_snapshot);
      const cpf = decryptPII(text(identityRow?.cpfCiphertext));
      const invoice = row(invoiceResult.data);
      if (melhorEnvioEnvironment() === "production" && (!invoice || !/^\d{44}$/u.test(text(invoice.reference)))) {
        await db.from("shipments").update({ operation_state: "awaiting_invoice", last_error_code: null }).eq("id", parsed.data.shipmentId);
        return NextResponse.json({ ok: false, message: "A NF-e autorizada é obrigatória antes de criar o envio em produção." }, { status: 409, headers: noStore });
      }
      const allProducts = rows(itemsResult.data).map((item) => ({ id: text(item.variant_id), name: text(item.product_name_snapshot).slice(0, 255),
        quantity: number(item.quantity), unitary_value: number(item.unit_price) }));
      const packageSnapshot = rows(shipment.package_snapshot);
      const packageProducts = packageSnapshot.length === 1 ? rows(packageSnapshot[0]?.products) : [];
      const separateVolume = row(shipment.metadata_sanitized)?.separateVolume === true;
      const selectedProducts = packageProducts.length ? packageProducts.map((reference) => {
        const source = allProducts.find((item) => item.id === text(reference.id));
        const quantity = number(reference.quantity);
        return source && Number.isInteger(quantity) && quantity > 0 && quantity <= source.quantity
          ? { ...source, quantity } : null;
      }).filter((item): item is NonNullable<typeof item> => item !== null) : separateVolume ? [] : allProducts;
      const products = selectedProducts.map(({ name, quantity, unitary_value }) => ({ name, quantity, unitary_value }));
      const volumes = rows(shipment.package_snapshot).map((item) => {
        const dimensions = row(item.dimensions);
        return { height: number(dimensions?.height), width: number(dimensions?.width), length: number(dimensions?.length), weight: number(item.weight) };
      }).filter((item) => Object.values(item).every((value) => value > 0));
      if (!products.length || !volumes.length || !address) throw new MelhorEnvioError("validation", 409, false);
      const to: MelhorEnvioParty = { name: text(order.customer_name_snapshot), email: text(order.customer_email_snapshot),
        phone: text(order.customer_phone_snapshot).replace(/\D/gu, ""), document: cpf,
        address: text(address.street), complement: text(address.complement), number: text(address.number), district: text(address.district),
        city: text(address.city), postal_code: text(address.postalCode).replace(/\D/gu, ""), state_abbr: text(address.state).toUpperCase(), country_id: "BR" };
      const payload: MelhorEnvioShipmentInput = { serviceId: text(quote.service_id), from: envParty(), to, products, volumes,
        options: { platform: process.env.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
          insurance_value: products.reduce((total, item) => total + item.quantity * item.unitary_value, 0),
          receipt: false, own_hand: false, reverse: false, tags: [{ tag: text(order.public_code), url: null }],
          ...(invoice ? { invoice: { key: text(invoice.reference) } } : {}) } };
      const created = await provider.createShipment(payload);
      const saved = await db.from("shipments").update({ external_id: created.externalId, operation_state: "created",
        last_error_code: null, updated_at: new Date().toISOString() }).eq("id", parsed.data.shipmentId).eq("operation_state", "creating")
        .select("id").maybeSingle();
      if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
      claimedOperation = false;
      data = created;
    } else {
      if (!externalId) return NextResponse.json({ ok: false, message: "Crie o envio antes desta ação." }, { status: 409, headers: noStore });
      if (parsed.data.action === "purchase") {
        if (text(shipment.operation_state) !== "created") throw new MelhorEnvioError("conflict", 409, false);
        const [orderState, invoiceState] = await Promise.all([
          db.from("orders").select("status,payment_status").eq("id", text(shipment.order_id)).maybeSingle(),
          melhorEnvioEnvironment() === "production"
            ? db.from("erp_documents").select("reference").eq("order_id", text(shipment.order_id)).eq("document_type", "nfe")
              .eq("status", "authorized").order("updated_at", { ascending: false }).limit(1).maybeSingle()
            : Promise.resolve({ data: null, error: null })
        ]);
        if (orderState.data?.payment_status !== "approved" || ["cancellation_requested", "cancelled", "refund_pending", "refunded"]
          .includes(text(orderState.data?.status))) throw new MelhorEnvioError("conflict", 409, false);
        if (melhorEnvioEnvironment() === "production" && (invoiceState.error || !/^\d{44}$/u.test(text(invoiceState.data?.reference)))) {
          throw new MelhorEnvioError("conflict", 409, false);
        }
        const claimed = await db.from("shipments").update({ operation_state: "purchasing", updated_at: new Date().toISOString() })
          .eq("id", parsed.data.shipmentId).eq("operation_state", "created").select("id").maybeSingle();
        if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
        claimedOperation = true;
        await provider.purchase([externalId]);
        const saved = await db.from("shipments").update({ operation_state: "purchased", last_error_code: null, updated_at: new Date().toISOString() })
          .eq("id", parsed.data.shipmentId).eq("operation_state", "purchasing").select("id").maybeSingle();
        if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
        claimedOperation = false;
      } else if (parsed.data.action === "generate") {
        if (text(shipment.operation_state) !== "purchased") throw new MelhorEnvioError("conflict", 409, false);
        const orderState = await db.from("orders").select("status,payment_status").eq("id", text(shipment.order_id)).maybeSingle();
        if (orderState.data?.payment_status !== "approved" || ["cancellation_requested", "cancelled", "refund_pending", "refunded"]
          .includes(text(orderState.data?.status))) throw new MelhorEnvioError("conflict", 409, false);
        const claimed = await db.from("shipments").update({ operation_state: "generating", updated_at: new Date().toISOString() })
          .eq("id", parsed.data.shipmentId).eq("operation_state", "purchased").select("id").maybeSingle();
        if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
        claimedOperation = true;
        await provider.generate([externalId]);
        const saved = await db.from("shipments").update({ operation_state: "generated", status: "label_created", label_path: `private:${externalId}`,
          last_error_code: null, updated_at: new Date().toISOString() }).eq("id", parsed.data.shipmentId).eq("operation_state", "generating")
          .select("id").maybeSingle();
        if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
        claimedOperation = false;
      } else if (parsed.data.action === "preview") data = { url: await provider.preview([externalId]) };
      else if (parsed.data.action === "print") data = { url: await provider.print([externalId]) };
      else if (parsed.data.action === "sync") {
        const remote = await provider.getShipment(externalId);
        const remoteStatus = text(remote.status).toLowerCase();
        const reconciled = remoteOperation(remoteStatus);
        const currentOperation = text(shipment.operation_state);
        const canAdvance = reconciled && (["reconciliation_required", "failed"].includes(currentOperation)
          || (operationRank[reconciled.operation_state] ?? -1) >= (operationRank[currentOperation] ?? 0));
        data = { synchronized: true, remoteStatus, trackingCode: text(remote.tracking) };
        const updated = await db.from("shipments").update({ ...(text(remote.tracking) ? { tracking_code: text(remote.tracking) } : {}),
          ...(canAdvance ? reconciled : {}), updated_at: new Date().toISOString(), last_error_code: null })
          .eq("id", parsed.data.shipmentId).eq("operation_state", currentOperation).select("id").maybeSingle();
        if (updated.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
      } else {
        if (text(shipment.operation_state) === "created") {
          const cancelled = await db.from("shipments").update({ operation_state: "cancelled", status: "cancelled",
            updated_at: new Date().toISOString(), last_error_code: null }).eq("id", parsed.data.shipmentId)
            .eq("operation_state", "created").select("id").maybeSingle();
          if (cancelled.error || !cancelled.data) throw new MelhorEnvioError("conflict", 409, false);
        } else {
        if (!(await provider.isCancellable(externalId))) return NextResponse.json({ ok: false,
          message: "A etiqueta não pode ser cancelada; encaminhe para tratamento operacional." }, { status: 409, headers: noStore });
        const claimed = await db.from("shipments").update({ operation_state: "cancelling", updated_at: new Date().toISOString() })
          .eq("id", parsed.data.shipmentId).in("operation_state", ["created", "purchased", "generated"])
          .select("id").maybeSingle();
        if (claimed.error || !claimed.data) throw new MelhorEnvioError("conflict", 409, false);
        claimedOperation = true;
        await provider.cancel(externalId, parsed.data.reason ?? "Cancelamento do pedido");
        const saved = await db.from("shipments").update({ operation_state: "cancelled", status: "cancelled",
          updated_at: new Date().toISOString(), last_error_code: null }).eq("id", parsed.data.shipmentId).eq("operation_state", "cancelling")
          .select("id").maybeSingle();
        if (saved.error || !saved.data) throw new MelhorEnvioError("uncertain_write", 503, false);
        claimedOperation = false;
        }
      }
    }
    await db.from("audit_logs").insert({ actor_id: auth.userId, actor_role: auth.actorRole,
      action: `shipping.melhorenvio.${parsed.data.action}`, entity_type: "shipment", entity_id: parsed.data.shipmentId,
      new_data_sanitized: { provider: "melhorenvio", action: parsed.data.action } });
    return NextResponse.json({ ok: true, data }, { headers: noStore });
  } catch (error) {
    if (claimedOperation) await operationFailure(db, parsed.data.shipmentId, error);
    const status = error instanceof MelhorEnvioError ? error.httpStatus : 503;
    return NextResponse.json({ ok: false, message: error instanceof MelhorEnvioError && error.code === "uncertain_write"
      ? "O resultado é incerto. Sincronize a remessa antes de tentar novamente."
      : status === 409 ? "A ação não é permitida no estado atual." : "O Melhor Envio está indisponível. Tente novamente." },
    { status, headers: noStore });
  }
}
