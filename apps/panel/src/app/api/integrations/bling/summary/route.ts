import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingPanelRequest } from "@/lib/bling-server";
import { technicalNoStore } from "@/lib/technical-api";

export async function GET(request: NextRequest) {
  const db = await authorizeBlingPanelRequest(request);
  if (!db) return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: technicalNoStore });
  const result = await db.rpc("read_bling_management_summary");
  if (result.error) return NextResponse.json({ message: "Resumo indisponível." }, { status: 503, headers: technicalNoStore });
  const summary: unknown = result.data;
  return NextResponse.json({ summary }, { headers: technicalNoStore });
}
