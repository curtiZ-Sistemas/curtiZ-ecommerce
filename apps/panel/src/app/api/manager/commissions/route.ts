import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("simulate"),
    periodStart: z.string().date(),
    periodEnd: z.string().date()
  }),
  z.object({
    action: z.enum(["submit", "approve", "lock"]),
    closingId: z.string().uuid()
  }),
  z.object({
    action: z.literal("reopen"),
    closingId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000)
  })
]);

export async function POST(request: NextRequest) {
  if (!safeManagerOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise os dados da ação gerencial." },
      { status: 400, headers: managerNoStore }
    );
  }

  const result =
    parsed.data.action === "simulate"
      ? await auth.supabase.rpc("manager_create_commission_simulation", {
          p_period_start: parsed.data.periodStart,
          p_period_end: parsed.data.periodEnd
        })
      : await auth.supabase.rpc("manager_transition_commission_closing", {
          p_closing_id: parsed.data.closingId,
          p_action: parsed.data.action,
          p_reason: parsed.data.action === "reopen" ? parsed.data.reason : null
        });

  if (result.error) {
    return NextResponse.json(
      { message: "A ação não é permitida para o estado atual do fechamento." },
      { status: 409, headers: managerNoStore }
    );
  }

  const item: unknown = result.data;

  return NextResponse.json(
    {
      item,
      message:
        parsed.data.action === "simulate"
          ? "Simulação criada com os lançamentos elegíveis do período."
          : "Fechamento atualizado e registrado na auditoria."
    },
    { headers: managerNoStore }
  );
}
