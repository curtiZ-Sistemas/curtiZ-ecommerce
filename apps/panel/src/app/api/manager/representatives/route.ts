import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

const actionSchema = z.object({
  representativeId: z.string().uuid(),
  action: z.enum(["suspend", "reactivate"]),
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
    return NextResponse.json({ message: "Informe a ação e uma justificativa válida." }, { status: 400, headers: managerNoStore });
  }

  const result = await auth.supabase.rpc("manager_transition_representative", {
    p_representative_id: parsed.data.representativeId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason
  });
  if (result.error) {
    return NextResponse.json({ message: "A alteração não é permitida para o estado atual." }, { status: 409, headers: managerNoStore });
  }
  return NextResponse.json({ message: "Situação do representante atualizada e auditada." }, { headers: managerNoStore });
}
