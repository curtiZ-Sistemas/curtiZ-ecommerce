import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

const actionSchema = z.object({
  campaignId: z.string().uuid(),
  status: z.enum(["pending_review", "approved", "rejected", "scheduled", "published", "archived"]),
  reason: z.string().trim().min(3).max(1000)
});

export async function POST(request: NextRequest) {
  if (!safeManagerOrigin(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: managerNoStore });
  }
  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Informe a transição e uma justificativa válida." }, { status: 400, headers: managerNoStore });
  }
  const result = await auth.supabase.rpc("manager_transition_creative_campaign", {
    p_campaign_id: parsed.data.campaignId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason
  });
  if (result.error) {
    const forbidden = result.error.code === "42501";
    return NextResponse.json({ message: forbidden ? "Sua permissão não permite esta transição." : "A transição não é permitida para o estado atual." }, { status: forbidden ? 403 : result.error.code === "P0002" ? 404 : 409, headers: managerNoStore });
  }
  return NextResponse.json({ message: "Campanha atualizada conforme a aprovação configurada." }, { headers: managerNoStore });
}
