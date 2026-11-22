import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMercadoPagoCredentials, representativePointIntent, representativePointRefund } from "@curtiz/config";
import { reconcileRepresentativePoint, reconcileRepresentativePointRefund } from "@curtiz/integrations";
import { readBoundedJson, RequestBodyError } from "@curtiz/security";
import { consumePanelMutationBudget } from "@/lib/api-rate-limit";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { melhorEnvioEnvironment, panelMelhorEnvioProvider } from "@/lib/melhor-envio-server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore } from "@/lib/technical-api";

const approvals = z.object({ action: z.literal("approve_invoice"), orderId: z.string().uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/u), evidence: z.string().trim().min(10).max(200) }).strict();
const manualInvoice = z.object({ action: z.literal("submit_manual_invoice"), orderId: z.string().uuid(),
  invoiceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  invoiceKey: z.string().regex(/^31[0-9]{18}55003[0-9]{19}$/u) }).strict();
const returnId = z.string().uuid();
const reasons = z.object({ returnId, action: z.enum(["approve","reject"]),
  instructions: z.string().trim().min(5).max(500) }).strict();
const receipt = z.object({ action: z.literal("receive"), returnId, invoiceId: z.number().int().positive(),
  invoiceKey: z.string().regex(/^31\d{42}$/u), documentOrigin: z.enum(["buyer_outflow","own_inflow"]),
  restockQuantity: z.number().int().min(0).max(99), refundInCents: z.number().int().positive(),
  restockPairs: z.record(z.string().min(1).max(60),z.number().int().min(1).max(999)).optional(),
  inspectionReference: z.string().trim().min(10).max(200) }).strict();
const refund = z.object({ action: z.enum(["prepare_refund","refund"]), returnId }).strict();
const pickupSchedule = z.object({ action: z.literal("schedule_pickup"), returnId,
  pickupDate: z.iso.date() }).strict();
const pickupReceipt = z.object({ action: z.literal("confirm_pickup"), returnId,
  pickupReference: z.string().trim().min(10).max(200) }).strict();
const postalCode = z.string().regex(/^3[0-9]{7}$/u);
const paymentId = z.string().regex(/^[1-9][0-9]{0,14}$/u);
const createRoute = z.object({ action: z.literal("create_route"), route: z.object({
  name: z.string().trim().min(3).max(100),
  origin_postal_code: postalCode, destination_from: postalCode, destination_through: postalCode,
  delivery_cents: z.literal(0), estimated_days: z.number().int().min(0).max(60),
  bling_method_ids: z.object({ cash: paymentId.optional() }).strict(),
  point_terminal_id: z.null(),
  verified_evidence: z.string().trim().min(10).max(500), valid_until: z.iso.datetime({ offset: true })
}).strict() }).strict();
const closeRoute = z.object({ action: z.literal("close_route"), routeId: z.string().uuid() }).strict();
const print = z.object({ action: z.literal("print_label"), orderId: z.string().uuid() }).strict();
const collect = z.object({ action: z.literal("collection"), orderId: z.string().uuid(),
  operation: z.enum(["dispatch","confirm_delivery","cancel_before_dispatch","delivery_failed","returned_unpaid","cash_received"]),
  evidence: z.string().trim().min(10).max(200) }).strict();
const cashSchedule = z.object({ action: z.literal("schedule_cash_delivery"), orderId: z.string().uuid(),
  deliveryOn: z.iso.date() }).strict();
const mdfe = z.object({ action: z.literal("confirm_mdfe"), orderId: z.string().uuid(),
  accessKey: z.string().regex(/^31[0-9]{18}58[0-9]{22}$/u), protocol: z.string().regex(/^[0-9]{15}$/u),
  evidence: z.string().trim().min(10).max(200) }).strict();
const undeliveredReturn = z.object({ action: z.literal("register_undelivered_return"), orderId: z.string().uuid(),
  invoiceId: z.number().int().positive(), invoiceKey: z.string().regex(/^31[0-9]{20}004[0-9]{19}$/u),
  restockQuantity: z.number().int().min(0).max(99), evidence: z.string().trim().min(10).max(200) }).strict();
const point = z.object({ action: z.literal("point"), orderId: z.string().uuid(),
  operation: z.enum(["launch","refresh","cancel"]) }).strict();
const collectRefund = z.object({ action: z.literal("collection_refund"), returnId,
  cashEvidence: z.string().trim().min(10).max(200).optional() }).strict();
const input = z.union([approvals,manualInvoice,reasons,receipt,refund,pickupSchedule,pickupReceipt,print,collect,cashSchedule,mdfe,undeliveredReturn,
  point,collectRefund,createRoute,closeRoute]);
const send = (value: object, status = 200) => NextResponse.json(value,{ status, headers: technicalNoStore });

async function verified() {
  const db = await createServerSupabaseClient();
  if (!db) return null;
  const auth = await db.auth.getUser();
  return !auth.error && auth.data.user && await hasRequiredInternalMfa(db) ? db : null;
}

function pointRuntime() {
  const credentials = getMercadoPagoCredentials();
  const collector = process.env.REPRESENTATIVE_KIT_MP_COLLECTOR_ID?.trim() ?? "";
  const service = createServiceSupabaseClient();
  if (!service || process.env.APP_ENV !== "production" || credentials?.mode !== "production" || !/^\d{1,30}$/u.test(collector)) return null;
  return { accessToken: credentials.accessToken, collector, service };
}

export async function GET(request: NextRequest) {
  const db = await verified();
  if (!db) return send({ message: "Acesso negado." },403);
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode !== "returns" && mode !== "fiscal" && mode !== "collection" && mode !== "routes") return send({ message: "Selecione uma fila." },400);
  const result = await db.rpc({
    returns: "list_representative_kit_return_work", fiscal: "list_representative_kit_fiscal_work",
    collection: "list_representative_kit_collection_work",
    routes: "list_representative_kit_delivery_routes"
  }[mode]);
  if (result.error) return send({ message: "A fila de kits está indisponível." },result.error.code === "42501" ? 403 : 503);
  const rows: unknown = result.data;
  if (!Array.isArray(rows)) return send({ message: "A fila de kits está indisponível." },503);
  return send({ rows });
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return send({ message: "Origem não autorizada." },403);
  const db = await verified();
  if (!db) return send({ message: "Acesso negado." },403);
  if (!await consumePanelMutationBudget(request,db)) return send({ message: "Tente novamente em instantes." },429);
  try {
    const parsed = input.safeParse(await readBoundedJson(request,4096));
    if (!parsed.success) return send({ message: "Revise os dados informados." },400);
    const item = parsed.data;
    if (item.action === "create_route" || item.action === "close_route") {
      const result = await db.rpc("manage_representative_kit_delivery_route", {
        p_close: item.action === "close_route" ? item.routeId : null,
        p_route: item.action === "create_route" ? item.route : null
      });
      if (result.error || result.data !== true) return send({ message: "Confira os dados, a vigência e a sobreposição de CEPs." },
        result.error?.code === "42501" ? 403 : 409);
      return send({ ok: true });
    }
    if (item.action === "confirm_mdfe") {
      const result = await db.rpc("confirm_representative_kit_mdfe", {
        p_order: item.orderId, p_key: item.accessKey, p_protocol: item.protocol, p_evidence: item.evidence
      });
      return result.error || result.data !== true ? send({ message: "Confira a chave, o protocolo e a situação fiscal do pedido." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    if (item.action === "register_undelivered_return") {
      const result = await db.rpc("register_representative_kit_undelivered_return", {
        p_order: item.orderId,p_invoice: item.invoiceId,p_key: item.invoiceKey,
        p_restock_quantity: item.restockQuantity,p_evidence: item.evidence
      });
      return result.error || result.data !== true ? send({ message: "Confira a inspeção e a regra fiscal homologada para retorno sem entrega." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    if (item.action === "schedule_cash_delivery") {
      const result = await db.rpc("schedule_representative_kit_cash_delivery", { p_order: item.orderId, p_day: item.deliveryOn });
      return result.error || result.data !== true ? send({ message: "Confira a data e a situação fiscal do pedido." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    if (item.action === "collection") {
      const result = await db.rpc("manage_representative_kit_collection", {
        p_order: item.orderId, p_action: item.operation, p_evidence: item.evidence
      });
      if (result.error?.code === "23514" && result.error.message === "kit_mdfe_required")
        return send({ message: "Registre a conferência do MDF-e autorizado antes de registrar a saída." },409);
      return result.error || !result.data ? send({ message: "Confira a entrega e seu estado fiscal." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    if (item.action === "point") {
      const runtime = pointRuntime();
      if (!runtime || (item.operation === "launch" && process.env.REPRESENTATIVE_KIT_COLLECTION_ENABLED !== "true")) {
        return send({ message: "Terminal de recebimento indisponível." }, 503);
      }
      const opened = await db.rpc("open_representative_kit_point", {
        p_order: item.orderId, p_begin: item.operation === "launch"
      });
      const intent = representativePointIntent.safeParse(opened.data);
      if (opened.error || !intent.success) {
        return send({ message: "O pedido ainda não está pronto para o terminal." }, opened.error?.code === "42501" ? 403 : 409);
      }
      if (intent.data.confirmed) return send({ ok: true, status: "processed" });
      const payment = await reconcileRepresentativePoint(fetch, runtime, intent.data, item.operation);
      const linked = await runtime.service.rpc("record_representative_kit_point", {
        p_order: item.orderId, p_key: intent.data.pointKey, p_point_order: payment.id,
        p_status: payment.status, p_receipt: payment.receipt
      });
      if (linked.error || linked.data !== true) return send({ message: "Recebimento pendente de conciliação." }, 409);
      return send({ ok: true, status: payment.status });
    }
    if (item.action === "collection_refund") {
      const runtime = item.cashEvidence === undefined ? pointRuntime() : null;
      if (item.cashEvidence === undefined && (!runtime || process.env.REPRESENTATIVE_KIT_REFUNDS_ENABLED !== "true")) {
        return send({ message: "Estorno no Point indisponível." }, 503);
      }
      const prepared = await db.rpc("prepare_representative_kit_collection_refund", {
        p_return: item.returnId, p_cash_evidence: item.cashEvidence ?? null
      });
      if (!prepared.error && z.object({ confirmed: z.literal(true) }).safeParse(prepared.data).success) return send({ ok: true });
      const intent = representativePointRefund.safeParse(prepared.data);
      if (prepared.error || !intent.success || !runtime) {
        return send({ message: "Confira a autorização e o valor do estorno." }, prepared.error?.code === "42501" ? 403 : 409);
      }
      const reference = await reconcileRepresentativePointRefund(fetch, runtime, intent.data);
      if (!reference) return send({ message: "Estorno aguardando conciliação no Point." }, 409);
      const reconciled = await runtime.service.rpc("record_representative_kit_collection_refund", {
        p_refund: intent.data.refundId, p_provider_refund: reference
      });
      return reconciled.error || reconciled.data !== true
        ? send({ message: "Estorno aguardando conciliação no Point." }, 409) : send({ ok: true });
    }
    if (item.action === "print_label") {
      const result = await db.rpc("read_representative_kit_printable_label",{ p_order: item.orderId });
      const externalId: unknown = result.data;
      if (result.error || typeof externalId !== "string" || !/^[A-Za-z0-9-]{1,100}$/u.test(externalId)) {
        return send({ message: "Etiqueta indisponível para este pedido." }, result.error?.code === "42501" ? 403 : 409);
      }
      if (melhorEnvioEnvironment() !== "production") return send({ message: "Integração de expedição indisponível." },503);
      const url = await panelMelhorEnvioProvider().print([externalId]);
      return send({ ok: true,url });
    }
    if (item.action === "submit_manual_invoice") {
      const result = await db.rpc("submit_representative_kit_manual_invoice",{
        p_order: item.orderId, p_invoice: item.invoiceId, p_key: item.invoiceKey
      });
      return result.error || result.data !== true ? send({ message: "Confira a NF-e série 003 importada no Bling e a situação do pedido." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    if (item.action === "approve_invoice") {
      const result = await db.rpc("approve_representative_kit_bling_draft",{
        p_order: item.orderId,p_hash: item.hash,p_evidence: item.evidence
      });
      return result.error || result.data !== true ? send({ message: "O rascunho não pôde ser aprovado." },
        result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
    }
    const { action,returnId,...details } = item;
    const result = await db.rpc("manage_representative_kit_return", { p_return: returnId,p_action: action,p_details: details });
    return result.error || !result.data ? send({ message: "Confira os dados e o estado da devolução." },
      result.error?.code === "42501" ? 403 : 409) : send({ ok: true });
  } catch (error) {
    return send({ message: "Não foi possível concluir a operação." },error instanceof RequestBodyError ? error.status : 503);
  }
}
