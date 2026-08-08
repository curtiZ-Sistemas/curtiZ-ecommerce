import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const consentSchema = z.object({
  id: z.string().uuid(),
  policyVersion: z.string().trim().min(1).max(40),
  categories: z
    .record(z.string().max(60), z.boolean())
    .refine((value) => Object.keys(value).length <= 8),
  origin: z.enum(["banner", "preferences", "account"]),
  revoked: z.boolean().default(false)
});
function allowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_STORE_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]).has(origin);
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return NextResponse.json({ categories: [], cookies: [], policyVersion: "inventory-1" });
  const [categories, cookies, policy] = await Promise.all([
    supabase
      .from("cookie_categories")
      .select("id,label,description,required,sort_order")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("cookie_definitions")
      .select("name_pattern,category_id,provider,purpose,duration_description,first_party")
      .eq("active", true)
      .order("name_pattern"),
    supabase
      .from("published_legal_documents")
      .select("version")
      .eq("slug", "politica-de-cookies")
      .maybeSingle()
  ]);
  return NextResponse.json(
    {
      categories: categories.data ?? [],
      cookies: cookies.data ?? [],
      policyVersion:
        typeof policy.data?.version === "number" ? `cookies-v${policy.data.version}` : "inventory-1"
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}

export async function POST(request: NextRequest) {
  if (!allowedOrigin(request))
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403 });
  const parsed = consentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.categories.essential !== true)
    return NextResponse.json({ message: "Preferências inválidas." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return NextResponse.json(
      { message: "Não foi possível registrar as preferências." },
      { status: 503 }
    );
  const result = await supabase.rpc("record_cookie_consent", {
    p_id: parsed.data.id,
    p_policy_version: parsed.data.policyVersion,
    p_categories: parsed.data.categories,
    p_origin: parsed.data.origin,
    p_revoked: parsed.data.revoked
  });
  if (result.error)
    return NextResponse.json(
      { message: "Não foi possível registrar as preferências." },
      { status: 503 }
    );
  const response = NextResponse.json(
    { message: "Preferências registradas." },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set("curtiz-cookie-preferences", JSON.stringify(parsed.data.categories), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 365 * 24 * 60 * 60
  });
  return response;
}
