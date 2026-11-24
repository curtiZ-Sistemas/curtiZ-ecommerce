import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedJson, RequestBodyError } from "@curtiz/security";
import { consumePanelMutationBudget } from "@/lib/api-rate-limit";
import { blingConfigured, panelBlingClient } from "@/lib/bling-server";
import { isValidCnpj } from "@/lib/cnpj";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore } from "@/lib/technical-api";
import { issueWholesaleKitInvoice, cancelWholesaleKitInvoice } from "@/lib/wholesale-kit-invoice";

const text = (max: number) => z.string().trim().min(1).max(max);
const buyer = z.object({
  document: z.string().regex(/^[0-9]{14}$/u), name: z.string().trim().min(2).max(180),
  registration: z.string().trim().toUpperCase().regex(/^(?:[0-9]{13}|ISENTA)$/u),
  address: z.object({
    state: z.string().length(2), postal_code: z.string().regex(/^[0-9]{8}$/u), street: text(180), number: text(30),
    district: text(100), city: text(100), complement: z.string().trim().max(100).default("")
  }).strict()
}).strict();
const create = z.object({
  action: z.literal("create"), key: z.string().uuid(), kitId: z.string().uuid(),
  template: z.enum(["standard", "lower_restock", "upper_restock"]), quantity: z.number().int().min(1).max(99),
  unitPriceInCents: z.number().int().min(12).max(100_000_000), paymentMethod: z.enum(["pix", "cash"]), buyer
}).strict();
const batchItem = z.object({ kitId: z.string().uuid(), template: z.enum(["standard", "lower_restock", "upper_restock"]),
  quantity: z.number().int().min(1).max(99), unitPriceInCents: z.number().int().min(12).max(100_000_000) }).strict();
const batch = z.object({ action: z.literal("create_batch"), key: z.string().uuid(), items: z.array(batchItem).min(1).max(20),
  paymentMethod: z.enum(["pix", "cash"]), buyer }).strict();
const issue = z.object({ action: z.literal("issue"), id: z.string().uuid() }).strict();
const cancel = z.object({ action: z.literal("cancel"), id: z.string().uuid() }).strict();
const input = z.discriminatedUnion("action", [create, batch, issue, cancel]);

const send = (value: object, status = 200) => NextResponse.json(value, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

async function verified() {
  const db = await createServerSupabaseClient();
  if (!db) return null;
  const auth = await db.auth.getUser();
  return !auth.error && auth.data.user && await hasRequiredInternalMfa(db) ? db : null;
}

// Reasons the accountant can act on. Provider text and database details are never shown.
const cnpjInvalid = "O CNPJ informado não é válido.";
const outsideMg = "Só emitimos nota de atacado para empresas de Minas Gerais.";
const databaseReasons: Record<string, [number, string]> = {
  wholesale_buyer_cnpj_invalid: [422, cnpjInvalid],
  wholesale_buyer_outside_mg: [422, outsideMg],
  kit_grade_out_of_stock: [409, "Não há fichas suficientes deste kit em estoque."],
  wholesale_kit_unavailable: [409, "Este kit não está disponível para venda de atacado."],
  resale_not_homologated: [409, "Esta ficha ainda não tem a regra fiscal aprovada. Avise o responsável pela configuração fiscal."],
  wholesale_idempotency_conflict: [409, "Esta nota já foi criada com outros dados. Atualize a tela e confira a lista."]
};

export async function GET() {
  const db = await verified();
  if (!db) return send({ message: "Acesso negado." }, 403);
  const [offers, invoices] = await Promise.all([db.rpc("list_wholesale_kit_offers"), db.rpc("list_wholesale_kit_invoices", { p_limit: 100 })]);
  const error = offers.error ?? invoices.error;
  if (error) return send({ message: "As notas de atacado estão indisponíveis." }, error.code === "42501" ? 403 : 503);
  const offerRows: unknown = offers.data;
  const invoiceRows: unknown = invoices.data;
  if (!Array.isArray(offerRows) || !Array.isArray(invoiceRows)) return send({ message: "As notas de atacado estão indisponíveis." }, 503);
  return send({ offers: offerRows, invoices: invoiceRows });
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return send({ message: "Origem não autorizada." }, 403);
  const db = await verified();
  if (!db) return send({ message: "Acesso negado." }, 403);
  if (!await consumePanelMutationBudget(request, db)) return send({ message: "Tente novamente em instantes." }, 429);
  try {
    const parsed = input.safeParse(await readBoundedJson(request, 8192));
    if (!parsed.success) return send({ message: "Revise os dados informados." }, 400);
    const item = parsed.data;

    if (item.action === "create" || item.action === "create_batch") {
      if (item.buyer.registration === "ISENTA") return send({ code: "exempt_fiscal_rule_required", message: "Para revenda, este fluxo exige inscrição estadual ativa de MG. Consulte o cadastro do CNPJ no SINTEGRA; não contribuinte não pode ser emitido como revenda neste fluxo." }, 422);
      if (!isValidCnpj(item.buyer.document)) return send({ code: "cnpj_invalid", message: cnpjInvalid }, 422);
      if (item.buyer.address.state.toUpperCase() !== "MG") return send({ code: "buyer_outside_mg", message: outsideMg }, 422);
      const common = { p_key: item.key, p_payment_method: item.paymentMethod,
        p_buyer: { ...item.buyer, address: { ...item.buyer.address, state: "MG" } } };
      if (item.action === "create_batch" && new Set(item.items.map(line => line.kitId)).size !== item.items.length)
        return send({ message: "Selecione apenas uma ficha por kit." }, 400);
      const created = item.action === "create_batch"
        ? await db.rpc("create_wholesale_kit_invoice_batch", { ...common, p_items: item.items })
        : await db.rpc("create_wholesale_kit_invoice", { ...common, p_kit: item.kitId, p_template: item.template, p_quantity: item.quantity,
          p_unit_price_cents: item.unitPriceInCents });
      const invoice = record(created.data);
      if (created.error || !invoice) {
        const reason = databaseReasons[created.error?.message ?? ""];
        if (reason) return send({ code: created.error?.message, message: reason[1] }, reason[0]);
        if (created.error?.code === "42501") return send({ code: "permission_denied", message: "Sua conta não tem permissão fiscal para emitir esta nota. Procure o administrador." }, 403);
        return send({ message: "Não foi possível criar a nota." }, created.error?.code === "42501" ? 403 : 503);
      }
      return send({ invoice });
    }

    if (item.action === "cancel") {
      const local = await db.rpc("cancel_wholesale_kit_invoice", { p_id: item.id });
      if (local.error) return send({ message: "Não foi possível cancelar." }, local.error.code === "42501" ? 403 : 503);
      if (record(local.data)?.ok === true) return send({ ok: true });
      if (!blingConfigured()) return send({ message: "Integração temporariamente indisponível. Tente concluir o cancelamento pelo painel." }, 503);
      const service = createServiceSupabaseClient();
      if (!service) return send({ message: "Cancelamento indisponível." }, 503);
      const provider = panelBlingClient(service);
      const started = await db.rpc("begin_wholesale_kit_invoice_cancel", { p_id: item.id });
      const job = record(started.data);
      if (started.error) return send({ message: "Não foi possível iniciar o cancelamento." }, started.error.code === "42501" ? 403 : 503);
      if (!job) return send({ message: "Esta nota não pode ser cancelada agora. Ela já foi enviada ou está em andamento." }, 409);
      const ok = await cancelWholesaleKitInvoice({ db: service, provider, environment: process.env, invoiceId: item.id, job });
      return ok ? send({ ok: true }) : send({ code: "cancel_reconciliation_pending", message: "Cancelamento aguardando confirmação. Use Concluir cancelamento no painel; o estoque não será devolvido duas vezes." }, 409);
    }

    // issue (also the retry): the database allows one running attempt at a time.
    if (!blingConfigured()) return send({ message: "O Bling não está configurado neste ambiente." }, 503);
    const service = createServiceSupabaseClient();
    if (!service) return send({ message: "Emissão indisponível. Tente novamente." }, 503);
    const ready = await db.rpc("request_wholesale_kit_invoice_retry", { p_id: item.id });
    if (ready.error) return send({ message: "Não foi possível iniciar a emissão." }, ready.error.code === "42501" ? 403 : 503);
    if (ready.data !== true) return send({ message: "Esta nota já está sendo emitida ou foi finalizada. Atualize a lista." }, 409);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (value: object) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        try {
          const result = await issueWholesaleKitInvoice({
            db: service, provider: panelBlingClient(service), environment: process.env, invoiceId: item.id,
            onStep: step => write({ type: "step", step })
          });
          const list = await db.rpc("list_wholesale_kit_invoices", { p_limit: 100 });
          const rows: unknown = list.data;
          const invoice = Array.isArray(rows) ? rows.map(record).find(row => row?.id === item.id) ?? null : null;
          write({ type: "result", ...result, invoice });
        } catch {
          write({ type: "result", status: "error", code: "unexpected_error", invoice: null });
        } finally {
          controller.close();
        }
      }
    });
    return new Response(stream, { headers: { ...technicalNoStore, "content-type": "application/x-ndjson; charset=utf-8", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return send({ message: "Não foi possível concluir a operação." }, error instanceof RequestBodyError ? error.status : 503);
  }
}
