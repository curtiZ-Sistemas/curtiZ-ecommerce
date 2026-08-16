import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { helpCategories, searchBuiltInHelp, type HelpContent } from "@/lib/help-content";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  isUnknownRecord,
  readNumber,
  readQueryResult,
  readRows,
  readString
} from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const writeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("view"), contentId: z.string().uuid() }),
  z.object({
    action: z.literal("feedback"),
    contentId: z.string().uuid(),
    sessionId: z.string().uuid(),
    helpful: z.boolean(),
    reason: z.string().trim().max(500).optional(),
    actionTaken: z.string().trim().max(120).optional()
  })
]);

const headersFor = (request: Request) => ({
  "cache-control": "private, no-store",
  ...corsHeadersFor(request)
});

function builtInResponse(request: NextRequest, query: string, category: string, page: number) {
  const pageSize = 12;
  const all = searchBuiltInHelp(query, category || undefined);
  return NextResponse.json(
    {
      ok: true,
      contents: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      categories: helpCategories
    },
    { headers: headersFor(request) }
  );
}

function safeAction(value: unknown): HelpContent["relatedAction"] {
  if (!isUnknownRecord(value)) return undefined;
  const label = readString(value, "label");
  const href = readString(value, "href");
  return label && href.startsWith("/") && !href.startsWith("//") ? { label, href } : undefined;
}

const safeErrorCode = (value: unknown) =>
  isUnknownRecord(value) && typeof value.code === "string" ? value.code : "unknown";

function mapRow(row: Record<string, unknown>): HelpContent | null {
  const id = readString(row, "id");
  const slug = readString(row, "slug");
  const title = readString(row, "title");
  if (!id || !slug || !title) return null;
  const media = Array.isArray(row.media)
    ? row.media.flatMap((value) => {
        if (!isUnknownRecord(value)) return [];
        const url = readString(value, "url");
        return url.startsWith("https://")
          ? [{ type: readString(value, "type"), label: readString(value, "label"), url }]
          : [];
      })
    : [];
  const related = Array.isArray(row.related)
    ? row.related.flatMap((value) => {
        if (!isUnknownRecord(value)) return [];
        const relatedSlug = readString(value, "slug");
        const relatedTitle = readString(value, "title");
        return relatedSlug && relatedTitle ? [{ slug: relatedSlug, title: relatedTitle }] : [];
      })
    : [];
  return {
    id,
    slug,
    type: readString(row, "content_type", "article"),
    title,
    summary: readString(row, "summary"),
    body: readString(row, "body"),
    categoryName: readString(row, "category_name"),
    categorySlug: readString(row, "category_slug"),
    keywords: Array.isArray(row.keywords)
      ? row.keywords.filter((item): item is string => typeof item === "string")
      : [],
    ...(safeAction(row.related_action) ? { relatedAction: safeAction(row.related_action) } : {}),
    ...(media.length ? { media } : {}),
    ...(related.length ? { related } : {}),
    version: readNumber(row, "version"),
    updatedAt: readString(row, "updated_at")
  };
}

async function audienceFor(request: NextRequest) {
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo?.roles.includes("representative")) return "representative";
  if (demo?.roles.includes("customer")) return "customer";
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { audience: "visitor", supabase: null } as const;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return { audience: "visitor", supabase } as const;
  const roles = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const representative = readRows(roles.data).some(
    (row) => readString(row, "role") === "representative"
  );
  return { audience: representative ? "representative" : "customer", supabase } as const;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 160) ?? "";
  const category = request.nextUrl.searchParams.get("category")?.trim().slice(0, 100) ?? "";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const pageSize = 12;
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (process.env.DEMO_MODE === "true" || demo) {
    return builtInResponse(request, query, category, page);
  }

  const actor = await audienceFor(request);
  if (typeof actor === "string" || !actor.supabase) {
    console.error("[help-api] public search unavailable", {
      requestId: crypto.randomUUID(),
      reason: "supabase_client_unavailable"
    });
    return builtInResponse(request, query, category, page);
  }
  const [response, categoryResponse] = await Promise.all([
    actor.supabase.rpc("search_published_help", {
      p_query: query,
      p_audience: actor.audience,
      p_page: page,
      p_page_size: pageSize
    }),
    actor.supabase
      .from("support_categories")
      .select("name,slug")
      .eq("active", true)
      .eq("public_visible", true)
      .order("sort_order")
  ]);
  const result = readQueryResult(response as unknown);
  if (result.error || categoryResponse.error) {
    console.error("[help-api] published search failed", {
      requestId: crypto.randomUUID(),
      searchCode: safeErrorCode(result.error),
      categoryCode: safeErrorCode(categoryResponse.error)
    });
    return builtInResponse(request, query, category, page);
  }
  let contents = readRows(result.data).flatMap((row) => {
    const item = mapRow(row);
    return item ? [item] : [];
  });
  if (category) contents = contents.filter((item) => item.categorySlug === category);
  const total = readRows(result.data)[0] ? readNumber(readRows(result.data)[0]!, "total_count") : 0;
  if (total === 0) return builtInResponse(request, query, category, page);
  if (query) {
    await actor.supabase.rpc("record_help_search", {
      p_query: query,
      p_audience: actor.audience,
      p_result_count: total,
      p_origin: request.nextUrl.searchParams.get("origin") === "chat" ? "chat" : "help_center"
    });
  }
  return NextResponse.json(
    {
      ok: true,
      contents,
      total,
      categories: readRows(categoryResponse.data).map((row) => ({
        name: readString(row, "name"),
        slug: readString(row, "slug")
      }))
    },
    { headers: headersFor(request) }
  );
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const parsed = writeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ ok: false, message: "Feedback inválido." }, { status: 400 });
  if (process.env.DEMO_MODE === "true") return NextResponse.json({ ok: true });
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 503 });
  const { error } =
    parsed.data.action === "view"
      ? await supabase.rpc("record_help_view", { p_content_id: parsed.data.contentId })
      : await supabase.rpc("record_help_feedback", {
          p_content_id: parsed.data.contentId,
          p_session_id: parsed.data.sessionId,
          p_helpful: parsed.data.helpful,
          p_reason: parsed.data.reason ?? null,
          p_action: parsed.data.actionTaken ?? null
        });
  return NextResponse.json(
    error ? { ok: false, message: "Não foi possível registrar." } : { ok: true },
    {
      status: error ? 503 : 200,
      headers: { "cache-control": "no-store", ...corsHeadersFor(request) }
    }
  );
}
