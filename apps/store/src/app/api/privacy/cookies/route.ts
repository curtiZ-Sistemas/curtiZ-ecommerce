import { type NextRequest, NextResponse } from "next/server";
import { REFERRAL_ATTRIBUTION_COOKIE } from "@curtiz/security";
import { z } from "zod";
import {
  cookieInventoryVersion,
  defaultCookieInventory,
  normalizeCookieCategoryId,
  type CookieCategory,
  type CookieInventoryItem,
  type StorageType
} from "../../../../lib/privacy/cookie-inventory";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const supportedCategoryIds = new Set(["essential", "preferences", "functional", "analytics", "marketing"]);
const consentSchema = z.object({
  id: z.string().uuid(),
  policyVersion: z.string().trim().min(1).max(40),
  categories: z
    .record(z.string().max(60), z.boolean())
    .refine(
      (value) =>
        Object.keys(value).length <= 8 &&
        Object.keys(value).every((key) => supportedCategoryIds.has(key))
    ),
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

function consentResponse(
  request: NextRequest,
  categories: Record<string, boolean>,
  persisted: boolean
) {
  const response = NextResponse.json(
    {
      message: persisted
        ? "Preferências registradas."
        : "Cookies opcionais permanecem desativados neste dispositivo.",
      persisted
    },
    { headers: { "cache-control": "no-store" } }
  );
  response.cookies.set("curtiz-cookie-preferences", JSON.stringify(categories), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 365 * 24 * 60 * 60
  });
  if (categories.preferences !== true) {
    response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 0
    });
  }
  return response;
}

const hasOptionalConsent = (categories: Record<string, boolean>) =>
  Object.entries(categories).some(([key, enabled]) => key !== "essential" && enabled);

function persistenceFailure(request: NextRequest, categories: Record<string, boolean>) {
  if (!hasOptionalConsent(categories)) return consentResponse(request, categories, false);
  return NextResponse.json(
    { message: "Não foi possível registrar as preferências.", persisted: false },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

function normalizeConsentCategories(categories: Record<string, boolean>) {
  return {
    essential: true,
    preferences: categories.preferences === true || categories.functional === true,
    analytics: categories.analytics === true,
    marketing: categories.marketing === true
  };
}

function inventoryCategory(value: unknown): CookieCategory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.label !== "string" ||
    typeof row.description !== "string"
  )
    return null;
  return {
    id: normalizeCookieCategoryId(row.id),
    label: row.id === "functional" ? "Preferências" : row.label,
    description: row.description,
    required: row.required === true
  };
}

function inventoryItem(value: unknown): CookieInventoryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.name_pattern !== "string" ||
    typeof row.category_id !== "string" ||
    typeof row.provider !== "string" ||
    typeof row.purpose !== "string" ||
    typeof row.duration_description !== "string"
  )
    return null;
  const storageType: StorageType = ["local_storage", "session_storage"].includes(
    String(row.storage_type)
  )
    ? (row.storage_type as StorageType)
    : "cookie";
  return {
    name_pattern: row.name_pattern,
    category_id: normalizeCookieCategoryId(row.category_id),
    provider: row.provider,
    purpose: row.purpose,
    duration_description: row.duration_description,
    first_party: row.first_party !== false,
    storage_type: storageType
  };
}

function inventoryItemKey(item: CookieInventoryItem) {
  return item.name_pattern === "sb-*-auth-token"
    ? "sb-*-auth-token*"
    : item.name_pattern.toLowerCase();
}

export async function GET() {
  const fallback = defaultCookieInventory();
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return NextResponse.json(fallback, {
      headers: { "cache-control": "public, max-age=300" }
    });
  const [categories, cookies, policy] = await Promise.all([
    supabase
      .from("cookie_categories")
      .select("id,label,description,required,sort_order")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("cookie_definitions")
      .select("*")
      .eq("active", true)
      .order("name_pattern"),
    supabase
      .from("published_legal_documents")
      .select("version")
      .eq("slug", "politica-de-cookies")
      .maybeSingle()
  ]);
  const categoryMap = new Map(fallback.categories.map((category) => [category.id, category]));
  for (const category of (categories.data ?? []).map(inventoryCategory)) {
    if (category) categoryMap.set(category.id, category);
  }
  const cookieMap = new Map(
    fallback.cookies.map((cookie) => [inventoryItemKey(cookie), cookie])
  );
  for (const cookie of (cookies.data ?? []).map(inventoryItem)) {
    if (!cookie || cookie.name_pattern === "curtiz-referral-attribution") continue;
    cookieMap.set(inventoryItemKey(cookie), cookie);
  }
  const legalVersion =
    typeof policy.data?.version === "number" ? `cookies-v${policy.data.version}` : "cookies";
  return NextResponse.json(
    {
      categories: [...categoryMap.values()],
      cookies: [...cookieMap.values()],
      policyVersion: `${legalVersion}-${cookieInventoryVersion}`
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
  const normalizedCategories = normalizeConsentCategories(parsed.data.categories);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return persistenceFailure(request, normalizedCategories);

  try {
    const result = await supabase.rpc("record_cookie_consent", {
      p_id: parsed.data.id,
      p_policy_version: parsed.data.policyVersion,
      p_categories: normalizedCategories,
      p_origin: parsed.data.origin,
      p_revoked: parsed.data.revoked
    });
    if (result.error) return persistenceFailure(request, normalizedCategories);
  } catch {
    return persistenceFailure(request, normalizedCategories);
  }
  return consentResponse(request, normalizedCategories, true);
}
