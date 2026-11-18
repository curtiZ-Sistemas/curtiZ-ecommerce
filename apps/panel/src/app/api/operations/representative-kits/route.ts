import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedJson, RequestBodyError } from "@curtiz/security";
import { consumePanelMutationBudget } from "@/lib/api-rate-limit";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore } from "@/lib/technical-api";

const approvals = z.object({ action: z.literal("approve_invoice"), orderId: z.string().uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/u), evidence: z.string().trim().min(10).max(200) }).strict();
const returnId = z.string().uuid();
const reasons = z.object({ returnId, action: z.enum(["approve","reject"]),
  instructions: z.string().trim().min(5).max(500) }).strict();
const receipt = z.object({ action: z.literal("receive"), returnId, invoiceId: z.number().int().positive(),
  invoiceKey: z.string().regex(/^31\d{42}$/u), documentOrigin: z.enum(["buyer_outflow","own_inflow"]),
  restockQuantity: z.number().int().min(0).max(99), refundInCents: z.number().int().positive(),
  inspectionReference: z.string().trim().min(10).max(200) }).strict();
const refund = z.object({ action: z.literal("refund"), returnId }).strict();
const input = z.union([approvals,reasons,receipt,refund]);
const send = (value: object, status = 200) => NextResponse.json(value,{ status, headers: technicalNoStore });

async function verified() {
  const db = await createServerSupabaseClient();
  if (!db) return null;
  const auth = await db.auth.getUser();
  return !auth.error && auth.data.user && await hasRequiredInternalMfa(db) ? db : null;
}

export async function GET(request: NextRequest) {
  const db = await verified();
  if (!db) return send({ message: "Acesso negado." },403);
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode !== "returns" && mode !== "fiscal") return send({ message: "Selecione uma fila." },400);
  const result = await db.rpc(mode === "returns" ? "list_representative_kit_return_work" : "list_representative_kit_fiscal_work");
  if (result.error) return send({ message: "A fila de kits está indisponível." },result.error.code === "42501" ? 403 : 503);
  return send({ rows: result.data });
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
