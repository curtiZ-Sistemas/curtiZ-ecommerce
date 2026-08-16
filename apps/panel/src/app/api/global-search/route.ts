import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, objectRows, privateNoStore, unauthorizedAdminResponse } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

const roleMap = {
  administracao: "admin",
  operacional: "operational",
  gerencia: "manager",
  tecnico: "technical"
} as const;

type PanelRole = keyof typeof roleMap;
type SearchItem = { id: string; title: string; subtitle: string; href: string };
type SearchGroup = { type: string; label: string; items: SearchItem[] };

const cleanSearch = (value: string) =>
  value.trim().replace(/[,%_()]/gu, " ").replace(/\s+/gu, " ").slice(0, 80);

const text = (value: unknown) => (typeof value === "string" ? value : "");

async function can(
  supabase: NonNullable<Awaited<ReturnType<typeof authorizeAdminRequest>>>["supabase"],
  permission: string
) {
  const result = await supabase.rpc("has_permission", { permission_code: permission });
  return !result.error && result.data === true;
}

function response(groups: SearchGroup[], requestId: string) {
  return NextResponse.json(
    { groups },
    { headers: { ...privateNoStore, "x-request-id": requestId } }
  );
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const requestedRole = request.nextUrl.searchParams.get("role") ?? "";
  if (!(requestedRole in roleMap)) return response([], requestId);
  const role = requestedRole as PanelRole;
  const query = cleanSearch(request.nextUrl.searchParams.get("q") ?? "");
  if (query.length < 2) return response([], requestId);

  if (verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)) {
    return response([], requestId);
  }

  const auth = await authorizeAdminRequest(request, [roleMap[role]]);
  if (!auth) return unauthorizedAdminResponse();

  const permissionNames = [
    "products.read",
    "orders.read_all",
    "orders.read_assigned",
    "users.read",
    "representatives.read_all",
    "support.conversations.read"
  ] as const;
  const permissionValues = await Promise.all(
    permissionNames.map((permission) => can(auth.supabase, permission))
  );
  const permissions = new Map(permissionNames.map((permission, index) => [permission, permissionValues[index]]));
  const groups: SearchGroup[] = [];

  if (role === "administracao" && permissions.get("products.read")) {
    const variants = await auth.supabase
      .from("product_variants")
      .select("product_id")
      .ilike("sku", `%${query}%`)
      .limit(12);
    const productIds = objectRows(variants.data).map((row) => text(row.product_id)).filter(Boolean);
    let productsQuery = auth.supabase.from("products").select("id,name,slug,status").limit(5);
    const clauses = [`name.ilike.%${query}%`, `slug.ilike.%${query}%`];
    if (productIds.length) clauses.push(`id.in.(${productIds.join(",")})`);
    productsQuery = productsQuery.or(clauses.join(","));
    const products = await productsQuery;
    const items = objectRows(products.data).map((row) => ({
      id: text(row.id),
      title: text(row.name),
      subtitle: `Produto · ${text(row.status) || "status não informado"}`,
      href: `/administracao/produtos?q=${encodeURIComponent(text(row.name) || query)}`
    })).filter((item) => item.id && item.title);
    if (items.length) groups.push({ type: "products", label: "Produtos", items });
  }

  if (role !== "tecnico" && (permissions.get("orders.read_all") || permissions.get("orders.read_assigned"))) {
    const orders = await auth.supabase
      .from("orders")
      .select("id,public_code,customer_name_snapshot,status")
      .or(`public_code.ilike.%${query}%,customer_name_snapshot.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(5);
    const orderPath = role === "gerencia" ? "pedidos-vendas" : "pedidos";
    const items = objectRows(orders.data).map((row) => ({
      id: text(row.id),
      title: text(row.public_code),
      subtitle: `${text(row.customer_name_snapshot) || "Cliente"} · ${text(row.status)}`,
      href: `/${role}/${orderPath}?q=${encodeURIComponent(text(row.public_code) || query)}`
    })).filter((item) => item.id && item.title);
    if (items.length) groups.push({ type: "orders", label: "Pedidos", items });
  }

  if ((role === "administracao" || role === "gerencia") && permissions.get("users.read")) {
    const profiles = await auth.supabase
      .from("profiles")
      .select("id,full_name,email_snapshot,status")
      .or(`full_name.ilike.%${query}%,email_snapshot.ilike.%${query}%`)
      .limit(5);
    const items = objectRows(profiles.data).map((row) => ({
      id: text(row.id),
      title: text(row.full_name),
      subtitle: `${text(row.email_snapshot)} · ${text(row.status)}`,
      href: `/${role}/clientes?q=${encodeURIComponent(text(row.full_name) || query)}`
    })).filter((item) => item.id && item.title);
    if (items.length) groups.push({ type: "customers", label: "Clientes", items });
  }

  if (role !== "tecnico" && permissions.get("representatives.read_all")) {
    const representatives = await auth.supabase
      .from("representatives")
      .select("id,public_code,referral_code,status")
      .or(`public_code.ilike.%${query}%,referral_code.ilike.%${query}%`)
      .limit(5);
    const items = objectRows(representatives.data).map((row) => ({
      id: text(row.id),
      title: text(row.public_code),
      subtitle: `Indicação ${text(row.referral_code)} · ${text(row.status)}`,
      href: `/${role}/representantes?q=${encodeURIComponent(text(row.public_code) || query)}`
    })).filter((item) => item.id && item.title);
    if (items.length) groups.push({ type: "representatives", label: "Representantes", items });
  }

  if (role !== "tecnico" && permissions.get("support.conversations.read")) {
    const support = await auth.supabase
      .from("support_conversations")
      .select("id,public_code,subject,status")
      .or(`public_code.ilike.%${query}%,subject.ilike.%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(5);
    const items = objectRows(support.data).map((row) => ({
      id: text(row.id),
      title: text(row.public_code),
      subtitle: `${text(row.subject)} · ${text(row.status)}`,
      href: `/${role}/atendimentos?q=${encodeURIComponent(text(row.public_code) || query)}`
    })).filter((item) => item.id && item.title);
    if (items.length) groups.push({ type: "support", label: "Atendimentos", items });
  }

  return response(groups, requestId);
}
