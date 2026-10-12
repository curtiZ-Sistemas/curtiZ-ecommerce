import { readJsonResponse, REFERRAL_ATTRIBUTION_COOKIE } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  cookiePolicyVersion,
  defaultCookieInventory,
  normalizeCookieCategoryId,
  type CookieCategory,
  type CookieInventoryItem,
  type StorageType
} from "../../../../lib/privacy/cookie-inventory";
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  consentSigningKey,
  createConsentToken,
  policyVersionPattern,
  type ConsentCategories
} from "../../../../lib/privacy/consent-token";
import { isAllowedRequestOrigin } from "../../../../lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const supportedCategoryIds = new Set(["essential", "preferences", "functional", "analytics", "marketing"]);
const consentSchema = z.object({
  id: z.string().uuid(),
  policyVersion: z.string().trim().regex(policyVersionPattern),
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
const noStore = { "cache-control": "no-store" };

const hasOptionalConsent = (categories: ConsentCategories) =>
  categories.preferences || categories.analytics || categories.marketing;

function consentResponse(
  request: NextRequest,
  consent: { id: string; policyVersion: string; categories: ConsentCategories },
  persisted: boolean
) {
  const response = NextResponse.json(
    {
      message: persisted
        ? "Preferências registradas."
        : "Cookies opcionais permanecem desativados neste dispositivo.",
      persisted,
      id: consent.id
    },
    { headers: noStore }
  );
  const secure = request.nextUrl.protocol === "https:";
  // Sem chave de assinatura o servidor não consegue comprovar a escolha: apaga o cookie e os
  // recursos opcionais do servidor permanecem desativados (falha fechada).
  const token = createConsentToken(consent, consentSigningKey());
  response.cookies.set(CONSENT_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: token ? CONSENT_COOKIE_MAX_AGE_SECONDS : 0
  });
  if (!consent.categories.preferences) {
    response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0
    });
  }
  return response;
}

function persistenceFailure(
  request: NextRequest,
  consent: { id: string; policyVersion: string; categories: ConsentCategories }
) {
  // A recusa não precisa de prova remota para valer; o aceite precisa ficar registrado.
  if (!hasOptionalConsent(consent.categories)) return consentResponse(request, consent, false);
  return NextResponse.json(
    { message: "Não foi possível registrar as preferências. Os cookies opcionais continuam desativados.", persisted: false },
    { status: 503, headers: noStore }
  );
}

function normalizeConsentCategories(categories: Record<string, boolean>): ConsentCategories {
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
  const publishedVersion = typeof policy.data?.version === "number" ? policy.data.version : null;
  return NextResponse.json(
    {
      categories: [...categoryMap.values()],
      cookies: [...cookieMap.values()],
      policyVersion: cookiePolicyVersion(publishedVersion),
      // Falha na consulta da política não pode invalidar escolhas: o navegador não pede de novo por isso.
      policyVersionKnown: !policy.error
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
}

type RecordResult = "recorded" | "owned_by_another_account" | "failed";

async function recordConsent(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  input: { id: string; policyVersion: string; categories: ConsentCategories; origin: string; revoked: boolean }
): Promise<RecordResult> {
  try {
    const result = await supabase.rpc("record_cookie_consent", {
      p_id: input.id,
      p_policy_version: input.policyVersion,
      p_categories: input.categories,
      p_origin: input.origin,
      p_revoked: input.revoked
    });
    if (!result.error) return "recorded";
    return result.error.code === "42501" ? "owned_by_another_account" : "failed";
  } catch {
    return "failed";
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request))
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: noStore });
  const boundedBody = await readJsonResponse(request, 32768);
  if (boundedBody instanceof Response) return boundedBody;
  const parsed = consentSchema.safeParse(boundedBody);
  if (!parsed.success || parsed.data.categories.essential !== true)
    return NextResponse.json({ message: "Preferências inválidas." }, { status: 400, headers: noStore });
  const consent = {
    id: parsed.data.id,
    policyVersion: parsed.data.policyVersion,
    categories: normalizeConsentCategories(parsed.data.categories)
  };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return persistenceFailure(request, consent);

  const input = { ...consent, origin: parsed.data.origin, revoked: parsed.data.revoked };
  let recorded = await recordConsent(supabase, input);
  // O identificador deste navegador já pertence a outra conta (ex.: computador compartilhado após
  // logout): registra uma nova escolha em vez de alterar a da outra pessoa.
  if (recorded === "owned_by_another_account") {
    consent.id = crypto.randomUUID();
    recorded = await recordConsent(supabase, { ...input, id: consent.id });
  }
  if (recorded !== "recorded") return persistenceFailure(request, consent);
  return consentResponse(request, consent, true);
}
