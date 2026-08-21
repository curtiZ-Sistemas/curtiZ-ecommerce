import { type NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";
const schema = z.coerce.number().int().min(1).max(90);
export async function GET(request: NextRequest) {
  const parsed = schema.safeParse(request.nextUrl.searchParams.get("days") ?? 30);
  if (!parsed.success)
    return NextResponse.json(
      { message: "Período inválido." },
      { status: 400, headers: managerNoStore }
    );
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo?.roles.includes("manager"))
    return NextResponse.json(
      {
        enabled: true,
        periodDays: parsed.data,
        overview: {
          views: 0,
          favorites: 0,
          cartAdds: 0,
          recommendationClicks: 0,
          unitsSold: 0,
          revenue: 0
        },
        topProducts: [],
        searches: [],
        sources: [],
        daily: [],
        demo: true
      },
      { headers: managerNoStore }
    );
  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();
  const result = await auth.supabase.rpc("get_intelligence_insights", { p_days: parsed.data });
  if (result.error)
    return NextResponse.json(
      { message: "Não foi possível consolidar os insights da loja." },
      { status: 503, headers: managerNoStore }
    );
  return NextResponse.json(result.data, { headers: managerNoStore });
}
