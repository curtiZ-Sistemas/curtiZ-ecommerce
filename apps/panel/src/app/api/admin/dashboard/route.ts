import { type NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
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
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession?.roles.includes("admin")) {
    return NextResponse.json(
      {
        demo: true,
        metrics: {
          grossRevenueInCents: 0,
          orders: 0,
          products: 0,
          lowStock: 0,
          customers: 0,
          representatives: 0,
          kits: 0,
          pendingReviews: 0,
          publishedBanners: 0,
          publishedCampaigns: 0
        },
        recentOrders: [],
        activities: [],
        warnings: ["Ambiente de demonstração: indicadores reais não são exibidos"]
      },
      { headers: privateNoStore }
    );
  }

  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse();

  const [
    orderCount,
    approvedSales,
    products,
    criticalStock,
    customers,
    representatives,
    kits,
    reviews,
    banners,
    campaigns,
    recentOrders,
    activities
  ] = await Promise.all([
    auth.supabase.from("orders").select("id", { count: "exact", head: true }),
    auth.supabase.rpc("admin_approved_sales_total_in_cents"),
    auth.supabase.from("products").select("id", { count: "exact", head: true }),
    auth.supabase.rpc("operational_critical_stock_count"),
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

  const criticalResults = [orderCount, approvedSales, products, criticalStock, customers];
  if (criticalResults.every((result) => result.error)) {
    return NextResponse.json(
      { message: "Os indicadores administrativos não estão disponíveis agora." },
      { status: 503, headers: privateNoStore }
    );
  }
  const grossRevenueInCents = approvedSales.error
    ? 0
    : Math.round(numberValue(approvedSales.data));
  const lowStock = criticalStock.error ? 0 : Math.round(numberValue(criticalStock.data));

  return NextResponse.json(
    {
      metrics: {
        grossRevenueInCents,
        orders: orderCount.count ?? 0,
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
        approvedSales.error ? "Vendas indisponíveis" : null,
        products.error ? "Produtos indisponíveis" : null,
        criticalStock.error ? "Estoque indisponível" : null,
        reviews.error ? "Avaliações indisponíveis" : null,
        activities.error ? "Auditoria indisponível" : null
      ].filter(Boolean)
    },
    { headers: privateNoStore }
  );
}
