import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  unauthorizedAdminResponse
} from "@/lib/admin-api";

type Target = { id: string; label: string; detail: string; route: string };

function value(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : "";
}

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cleanSearch(input: string) {
  return input.replaceAll(/[^\p{L}\p{N}\s._-]/gu, " ").trim().slice(0, 80);
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, ["admin", "manager"]);
  if (!auth) return unauthorizedAdminResponse();
  const type = request.nextUrl.searchParams.get("type") ?? "";
  const search = cleanSearch(request.nextUrl.searchParams.get("q") ?? "");

  if (type === "internal_page") {
    const pages: Target[] = [
      { id: "produtos", label: "Todos os produtos", detail: "/produtos", route: "/produtos" },
      { id: "ofertas", label: "Ofertas", detail: "/ofertas", route: "/ofertas" },
      { id: "lancamentos", label: "Lançamentos", detail: "/lancamentos", route: "/lancamentos" },
      { id: "mais-vendidos", label: "Mais vendidos", detail: "/mais-vendidos", route: "/mais-vendidos" },
      { id: "atendimento", label: "Atendimento", detail: "/atendimento", route: "/atendimento" }
    ];
    return NextResponse.json({ targets: pages }, { headers: privateNoStore });
  }

  let result;
  if (type === "product") {
    const variantMatches = search
      ? await auth.supabase.from("product_variants").select("product_id").ilike("sku", `%${search}%`).limit(20)
      : null;
    const productIds = objectRows(variantMatches?.data).map((item) => value(item, "product_id")).filter(Boolean);
    let query = auth.supabase.from("products").select("id,name,slug,status,product_variants(inventory(available_quantity,reserved_quantity))").order("name").limit(20);
    if (search) {
      const clauses = [`name.ilike.%${search}%`, `slug.ilike.%${search}%`];
      if (productIds.length) clauses.push(`id.in.(${productIds.join(",")})`);
      query = query.or(clauses.join(","));
    }
    result = await query;
  } else if (type === "category") {
    let query = auth.supabase.from("categories").select("id,name,slug,active").order("name").limit(40);
    if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    result = await query;
  } else if (type === "collection") {
    let query = auth.supabase.from("collections").select("id,name,slug,active").order("name").limit(40);
    if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    result = await query;
  } else if (type === "institutional_page" || type === "guide") {
    let query = auth.supabase.from("cms_pages").select("id,title,slug,status").order("title").limit(40);
    if (search) query = query.or(`title.ilike.%${search}%,slug.ilike.%${search}%`);
    result = await query;
  } else if (type === "campaign") {
    let query = auth.supabase.from("promotion_campaigns").select("id,name,status").order("name").limit(40);
    if (search) query = query.ilike("name", `%${search}%`);
    result = await query;
  } else {
    return NextResponse.json({ targets: [] }, { headers: privateNoStore });
  }

  if (result.error) {
    return NextResponse.json({ message: "Não foi possível carregar os destinos disponíveis." }, { status: 503, headers: privateNoStore });
  }
  const targets = objectRows(result.data).map((item): Target => {
    const id = value(item, "id");
    const name = value(item, "name") || value(item, "title");
    const slug = value(item, "slug");
    const status = value(item, "status") || (item.active === true ? "active" : "inactive");
    const stock = type === "product"
      ? objectRows(item.product_variants).reduce((total, variant) => {
          const inventory = objectRows(variant.inventory)[0];
          return total + Math.max(numeric(inventory?.available_quantity), 0);
        }, 0)
      : null;
    const route = type === "product"
      ? `/produto/${slug}`
      : type === "category"
        ? `/produtos?categoria=${encodeURIComponent(name)}`
        : type === "collection"
          ? `/produtos?colecao=${encodeURIComponent(name)}`
          : type === "campaign"
            ? "/ofertas"
            : `/${slug}`;
    return { id, label: name, detail: stock === null ? status : `${status} · ${stock} disponível(is)`, route };
  });
  return NextResponse.json({ targets }, { headers: privateNoStore });
}
