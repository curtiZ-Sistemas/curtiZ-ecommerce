import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { nextAvailableQuantity } from "@/lib/product-management";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
const rows = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const noStore = { "cache-control": "private, no-store" };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("restock"),
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99_999)
  }),
  z.object({
    action: z.literal("archive"),
    productId: z.string().uuid()
  })
]);

const safeOrigin = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = new Set([
    new URL(request.url).origin,
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim())
  ]);
  return configured.has(origin);
};

async function authorizedClient(request: NextRequest) {
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) return null;

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user || userResult?.error) return null;

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  const roles = rows(roleResult.data).map((item) => text(item.role));
  if (
    profileResult.error ||
    roleResult.error ||
    profileResult.data?.status !== "active" ||
    !roles.includes("admin")
  ) {
    return null;
  }
  return supabase;
}

const serializeProducts = (data: unknown) =>
  rows(data).map((product) => {
    const variants = rows(product.product_variants).map((variant) => {
      const inventory = rows(variant.inventory)[0] ?? record(variant.inventory);
      const available = number(inventory?.available_quantity);
      const reserved = number(inventory?.reserved_quantity);
      return {
        id: text(variant.id),
        sku: text(variant.sku),
        color: text(variant.color_name),
        size: text(variant.size),
        active: variant.active === true,
        available,
        reserved,
        sellable: Math.max(available - reserved, 0)
      };
    });
    return {
      id: text(product.id),
      name: text(product.name),
      slug: text(product.slug),
      status: text(product.status),
      priceInCents: Math.round(number(product.base_price) * 100),
      stock: variants.reduce((total, variant) => total + variant.sellable, 0),
      variants
    };
  });

export async function GET(request: NextRequest) {
  const supabase = await authorizedClient(request);
  if (!supabase) {
    return NextResponse.json(
      { message: "Acesso não autorizado ou catálogo indisponível." },
      { status: 401, headers: noStore }
    );
  }

  const result = await supabase
    .from("products")
    .select(
      "id,name,slug,status,base_price,product_variants(id,sku,color_name,size,active,inventory(available_quantity,reserved_quantity))"
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os produtos." },
      { status: 503, headers: noStore }
    );
  }

  return NextResponse.json({ products: serializeProducts(result.data) }, { headers: noStore });
}

export async function PATCH(request: NextRequest) {
  if (!safeOrigin(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: noStore });
  }
  const supabase = await authorizedClient(request);
  if (!supabase) {
    return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401, headers: noStore });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400, headers: noStore });
  }

  if (parsed.data.action === "archive") {
    const result = await supabase
      .from("products")
      .update({ status: "archived" })
      .eq("id", parsed.data.productId)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return NextResponse.json(
        { message: "Não foi possível excluir o produto." },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { ok: true, message: "Produto excluído do catálogo sem apagar o histórico de pedidos." },
      { headers: noStore }
    );
  }

  const variantResult = await supabase
    .from("product_variants")
    .select("id,product_id")
    .eq("id", parsed.data.variantId)
    .eq("product_id", parsed.data.productId)
    .maybeSingle();
  if (variantResult.error || !variantResult.data) {
    return NextResponse.json({ message: "Variação não encontrada." }, { status: 404, headers: noStore });
  }

  const inventoryResult = await supabase
    .from("inventory")
    .select("available_quantity,version")
    .eq("variant_id", parsed.data.variantId)
    .maybeSingle();
  if (inventoryResult.error || !inventoryResult.data) {
    return NextResponse.json(
      { message: "Registro de estoque não encontrado." },
      { status: 404, headers: noStore }
    );
  }

  const currentQuantity = number(inventoryResult.data.available_quantity);
  const currentVersion = number(inventoryResult.data.version);
  const updateResult = await supabase
    .from("inventory")
    .update({
      available_quantity: nextAvailableQuantity(currentQuantity, parsed.data.quantity),
      version: currentVersion + 1
    })
    .eq("variant_id", parsed.data.variantId)
    .eq("version", currentVersion)
    .select("variant_id")
    .maybeSingle();
  if (updateResult.error || !updateResult.data) {
    return NextResponse.json(
      { message: "O estoque mudou durante a atualização. Recarregue e tente novamente." },
      { status: 409, headers: noStore }
    );
  }

  return NextResponse.json(
    { ok: true, message: "Estoque atualizado. A disponibilidade pública foi recalculada." },
    { headers: noStore }
  );
}
