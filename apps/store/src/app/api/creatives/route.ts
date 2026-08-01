import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDemoCreative,
  DemoRepresentativeError,
  listDemoCreatives,
  transitionDemoCreative
} from "@/lib/demo-representative-store";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult, readRows, readString } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(3).max(160),
    campaign: z.string().trim().min(3).max(160),
    type: z.enum(["image", "video", "caption"]),
    platform: z.string().trim().min(2).max(80),
    caption: z.string().trim().min(3).max(4000)
  }),
  z.object({
    action: z.literal("transition"),
    creativeId: z.string().uuid().or(z.string().startsWith("creative-demo-")),
    status: z.enum(["pending_review", "approved", "published", "rejected", "archived"]),
    reason: z.string().trim().min(3).max(1000)
  })
]);

const responseHeaders = (request: Request): Record<string, string> => {
  return { "cache-control": "private, no-store", ...corsHeadersFor(request) };
};
const internalRoles = new Set(["admin", "manager"]);

export function OPTIONS(request: Request) {
  const headers = responseHeaders(request);
  if (request.headers.get("origin") && !("access-control-allow-origin" in headers)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: NextRequest) {
  const headers = responseHeaders(request);
  const demo =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demo) {
    const internal = request.nextUrl.searchParams.get("scope") === "internal";
    if (internal && !internalRoles.has(demo.role)) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers });
    }
    return NextResponse.json({ creatives: listDemoCreatives(!internal), demo: true }, { headers });
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  if (!supabase || !userResult?.data.user) {
    return NextResponse.json({ message: "Entre para continuar." }, { status: 401, headers });
  }
  const queryResponse: unknown = await supabase
    .from("creative_assets")
    .select(
      "id,title,description,asset_type,platform,status,storage_path,thumbnail_path,caption_text,starts_at,expires_at,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  const { data, error } = readQueryResult(queryResponse);
  if (error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os criativos." },
      { status: 403, headers }
    );
  }
  const creatives = await Promise.all(
    readRows(data).map(async (creative) => {
      const storagePath = readString(creative, "storage_path");
      if (!storagePath) return creative;
      const signed = await supabase.storage
        .from("representative-creatives")
        .createSignedUrl(storagePath, 300);
      return { ...creative, signedUrl: signed.data?.signedUrl ?? null };
    })
  );
  return NextResponse.json({ creatives, demo: false }, { headers });
}

export async function POST(request: NextRequest) {
  const headers = responseHeaders(request);
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403, headers });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Dados inválidos." }, { status: 400, headers });
  }
  const demo =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demo) {
    if (!internalRoles.has(demo.role)) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers });
    }
    try {
      const input = parsed.data;
      const creative =
        input.action === "create"
          ? createDemoCreative(input)
          : transitionDemoCreative(input.creativeId, input.status);
      return NextResponse.json(creative, {
        status: input.action === "create" ? 201 : 200,
        headers
      });
    } catch (error) {
      const known = error instanceof DemoRepresentativeError ? error : null;
      return NextResponse.json(
        { message: known?.message ?? "Operação não concluída." },
        { status: known?.status ?? 500, headers }
      );
    }
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user) {
    return NextResponse.json({ message: "Entre para continuar." }, { status: 401, headers });
  }
  const input = parsed.data;
  if (input.action === "create") {
    const queryResponse: unknown = await supabase
      .from("creative_assets")
      .insert({
        title: input.title,
        description: input.campaign,
        asset_type: input.type,
        platform: input.platform,
        caption_text: input.caption,
        status: "draft",
        created_by: user.id
      })
      .select()
      .single();
    const { data, error } = readQueryResult(queryResponse);
    return NextResponse.json(error ? { message: "Criação não permitida." } : data, {
      status: error ? 403 : 201,
      headers
    });
  }
  const rpcResponse: unknown = await supabase.rpc("transition_creative", {
    p_creative_id: input.creativeId,
    p_status: input.status,
    p_reason: input.reason
  });
  const { data, error } = readQueryResult(rpcResponse);
  return NextResponse.json(error ? { message: "Transição não permitida." } : data, {
    status: error ? 403 : 200,
    headers
  });
}
