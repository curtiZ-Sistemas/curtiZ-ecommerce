import { type NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

const schema = z.object({
  from: z.string().date(),
  to: z.string().date()
});

export async function GET(request: NextRequest) {
  const parsed = schema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to")
  });
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise o período informado." },
      { status: 400, headers: managerNoStore }
    );
  }

  const periodDays =
    Math.floor(
      (Date.parse(`${parsed.data.to}T12:00:00Z`) -
        Date.parse(`${parsed.data.from}T12:00:00Z`)) /
        86_400_000
    ) + 1;
  if (periodDays < 1 || periodDays > 367) {
    return NextResponse.json(
      { message: "O período deve ter entre 1 e 367 dias." },
      { status: 400, headers: managerNoStore }
    );
  }

  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo?.roles.includes("manager")) {
    return NextResponse.json(
      {
        demo: true,
        data: {
          comparison: { current: {}, previous: {} },
          series: [],
          products: [],
          categories: [],
          regions: [],
          representatives: [],
          campaigns: [],
          goals: []
        }
      },
      { headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const result = await auth.supabase.rpc("manager_strategic_metrics", {
    p_date_from: parsed.data.from,
    p_date_to: parsed.data.to
  });
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível consolidar a visão estratégica." },
      { status: 503, headers: managerNoStore }
    );
  }

  const strategyData: unknown = result.data;
  return NextResponse.json({ data: strategyData }, { headers: managerNoStore });
}
