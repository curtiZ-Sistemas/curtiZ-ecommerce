import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  unauthorizedAdminResponse
} from "@/lib/admin-api";

export const dynamic = "force-dynamic";

const numberValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();

  const [
    orders,
    products,
    inventory,
    customers,
    representatives,
    kits,
    reviews,
    banners,
    campaigns,
    recentOrders,
    activities
  ] = await Promise.all([
    auth.supabase.from("orders").select("id,grand_total", { count: "exact" }).limit(500),
    auth.supabase.from("products").select("id", { count: "exact", head: true }),
    auth.supabase.from("inventory").select("variant_id,available_quantity,minimum_quantity"),
    auth.supabase.from("profiles").select("id", { count: "exact", head: true }),
    auth.supabase.from("representatives").select("id", { count: "exact", head: true }),
    auth.supabase.from("kits").select("id", { count: "exact", head: true }),
    auth.supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    auth.supabase
      .from("banners")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
    auth.supabase
      .from("creative_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
    auth.supabase
      .from("orders")
      .select("id,public_code,status,payment_status,grand_total,created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    auth.supabase
      .from("audit_logs")
      .select("id,action,entity_type,created_at")
      .order("created_at", { ascending: false })
      .limit(6)
  ]);

  const criticalResults = [orders, products, inventory, customers];
  if (criticalResults.every((result) => result.error)) {
    return NextResponse.json(
      { message: "Os indicadores administrativos não estão disponíveis agora." },
      { status: 503, headers: privateNoStore }
    );
  }
  const orderRows = objectRows(orders.data);
  const inventoryRows = objectRows(inventory.data);
  const grossRevenueInCents = orderRows.reduce(
    (total, row) => total + Math.round(numberValue(row.grand_total) * 100),
    0
  );
  const lowStock = inventoryRows.filter(
    (row) => numberValue(row.available_quantity) <= numberValue(row.minimum_quantity)
  ).length;

  return NextResponse.json(
    {
      metrics: {
        grossRevenueInCents,
        orders: orders.count ?? orderRows.length,
        products: products.count ?? 0,
        lowStock,
        customers: customers.count ?? 0,
        representatives: representatives.count ?? 0,
        kits: kits.count ?? 0,
        pendingReviews: reviews.count ?? 0,
        publishedBanners: banners.count ?? 0,
        publishedCampaigns: campaigns.count ?? 0
      },
      recentOrders: recentOrders.error ? [] : objectRows(recentOrders.data),
      activities: activities.error ? [] : objectRows(activities.data),
      warnings: [
        products.error ? "Produtos indisponíveis" : null,
        inventory.error ? "Estoque indisponível" : null,
        reviews.error ? "Avaliações indisponíveis" : null,
        activities.error ? "Auditoria indisponível" : null
      ].filter(Boolean)
    },
    { headers: privateNoStore }
  );
}
