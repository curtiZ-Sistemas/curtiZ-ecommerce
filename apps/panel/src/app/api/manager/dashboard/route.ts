import { type NextRequest, NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  managerRows,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

const filtersSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  region: z.string().trim().max(40).optional(),
  product: z.string().uuid().optional(),
  category: z.string().uuid().optional(),
  model: z.string().uuid().optional(),
  representative: z.string().uuid().optional(),
  level: z.string().uuid().optional(),
  campaign: z.string().uuid().optional()
});

function optional(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

export async function GET(request: NextRequest) {
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession?.roles.includes("manager")) {
    return NextResponse.json(
      {
        demo: true,
        metrics: {
          series: [],
          pending: {},
          alerts: {},
          overview: {}
        },
        financial: {},
        options: {}
      },
      { headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const parsed = filtersSchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
    region: optional(request.nextUrl.searchParams.get("region")),
    product: optional(request.nextUrl.searchParams.get("product")),
    category: optional(request.nextUrl.searchParams.get("category")),
    model: optional(request.nextUrl.searchParams.get("model")),
    representative: optional(request.nextUrl.searchParams.get("representative")),
    level: optional(request.nextUrl.searchParams.get("level")),
    campaign: optional(request.nextUrl.searchParams.get("campaign"))
  });

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise o período e os filtros informados." },
      { status: 400, headers: managerNoStore }
    );
  }

  const periodDays =
    Math.floor(
      (Date.parse(`${parsed.data.to}T12:00:00Z`) -
        Date.parse(`${parsed.data.from}T12:00:00Z`)) /
        86_400_000
    ) + 1;
  if (periodDays < 1 || periodDays > 367) {
    return NextResponse.json(
      { message: "O período deve ter entre 1 e 367 dias." },
      { status: 400, headers: managerNoStore }
    );
  }

  const includeOptions = request.nextUrl.searchParams.get("includeOptions") !== "0";
  const emptyOptions = () => Promise.resolve({ data: [], error: null });

  const [metrics, financial, products, categories, models, representatives, levels, campaigns] =
    await Promise.all([
      auth.supabase.rpc("manager_dashboard_metrics", {
        p_date_from: parsed.data.from,
        p_date_to: parsed.data.to,
        p_region: parsed.data.region ?? null,
        p_product_id: parsed.data.product ?? null,
        p_category_id: parsed.data.category ?? null,
        p_model_id: parsed.data.model ?? null,
        p_representative_id: parsed.data.representative ?? null,
        p_level_id: parsed.data.level ?? null,
        p_campaign_id: parsed.data.campaign ?? null
      }),
      auth.supabase.rpc("manager_executive_financial_summary"),
      includeOptions
        ? auth.supabase.from("products").select("id,name").order("name").limit(300)
        : emptyOptions(),
      includeOptions
        ? auth.supabase.from("categories").select("id,name").order("name").limit(200)
        : emptyOptions(),
      includeOptions
        ? auth.supabase.from("product_models").select("id,name").order("name").limit(200)
        : emptyOptions(),
      includeOptions
        ? auth.supabase
            .from("representatives")
            .select("id,public_code,region_code,current_level_id")
            .order("public_code")
            .limit(500)
        : emptyOptions(),
      includeOptions
        ? auth.supabase.from("representative_levels").select("id,name,rank").order("rank").limit(100)
        : emptyOptions(),
      includeOptions
        ? auth.supabase.from("creative_campaigns").select("id,name").order("name").limit(200)
        : emptyOptions()
    ]);

  if (metrics.error) {
    return NextResponse.json(
      { message: "Não foi possível consolidar os indicadores gerenciais." },
      { status: 503, headers: managerNoStore }
    );
  }

  const metricData: unknown = metrics.data;
  const financialData: unknown = financial.data;

  const representativeRows = managerRows(representatives.data);
  const regions = [
    ...new Set(
      representativeRows
        .map((item) => (typeof item.region_code === "string" ? item.region_code : ""))
        .filter(Boolean)
    )
  ].sort((left, right) => left.localeCompare(right, "pt-BR"));

  return NextResponse.json(
    {
      metrics: metricData,
      financial: financial.error ? {} : financialData,
      warnings: [
        financial.error ? "resumo financeiro" : null,
        products.error ? "produtos" : null,
        categories.error ? "categorias" : null,
        models.error ? "modelos" : null,
        representatives.error ? "representantes" : null,
        levels.error ? "níveis" : null,
        campaigns.error ? "campanhas" : null
      ].filter((item): item is string => item !== null),
      ...(includeOptions
        ? {
            options: {
              products: managerRows(products.data),
              categories: managerRows(categories.data),
              models: managerRows(models.data),
              representatives: representativeRows,
              levels: managerRows(levels.data),
              campaigns: managerRows(campaigns.data),
              regions
            }
          }
        : {})
    },
    { headers: managerNoStore }
  );
}
