import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeTechnicalRequest,
  safeTechnicalOrigin,
  technicalNoStore,
  unauthorizedTechnicalResponse
} from "@/lib/technical-api";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["reprocess_job", "cancel_job"]), id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("reprocess_webhook"), id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("resolve_event"), id: z.string().uuid(), status: z.enum(["open", "investigating", "resolved", "ignored"]), note: z.string().trim().min(3).max(2000), assignedTo: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("set_feature_flag"), key: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/), enabled: z.boolean(), reason: z.string().trim().min(3).max(1000) })
]);

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  }
  const auth = await authorizeTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse();
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise a ação técnica e sua justificativa." }, { status: 400, headers: technicalNoStore });
  }

  const input = parsed.data;
  let result;
  switch (input.action) {
    case "reprocess_job":
    case "cancel_job":
      result = await auth.supabase.rpc("technical_transition_job", {
        p_job_id: input.id,
        p_action: input.action === "reprocess_job" ? "reprocess" : "cancel",
        p_reason: input.reason
      });
      break;
    case "reprocess_webhook":
      result = await auth.supabase.rpc("technical_reprocess_payment_event", {
        p_event_id: input.id,
        p_reason: input.reason
      });
      break;
    case "resolve_event":
      result = await auth.supabase.rpc("technical_resolve_event", {
        p_event_id: input.id,
        p_status: input.status,
        p_note: input.note,
        p_assigned_to: input.assignedTo ?? null
      });
      break;
    case "set_feature_flag":
      result = await auth.supabase.rpc("technical_set_feature_flag", {
        p_key: input.key,
        p_enabled: input.enabled,
        p_reason: input.reason
      });
      break;
  }

  if (result.error) {
    const forbidden = result.error.code === "42501";
    return NextResponse.json({ message: forbidden ? "Sua permissão não permite esta ação técnica." : "A ação não é permitida para o estado atual." }, { status: forbidden ? 403 : result.error.code === "P0002" ? 404 : 409, headers: technicalNoStore });
  }
  return NextResponse.json({ message: "Ação executada e registrada na auditoria." }, { headers: technicalNoStore });
}
