import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const schema = z.object({ versionId: z.string().uuid(), itemKey: z.string().max(100), metric: z.enum(["view", "click"]), device: z.enum(["desktop", "tablet", "mobile"]) });
export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  if (process.env.DEMO_MODE === "true") return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 503 });
  const result = await supabase.rpc("record_homepage_metric", { p_section_version_id: parsed.data.versionId, p_item_key: parsed.data.itemKey, p_metric: parsed.data.metric, p_device: parsed.data.device });
  return NextResponse.json({ ok: !result.error }, { status: result.error ? 400 : 200, headers: { "cache-control": "no-store" } });
}
