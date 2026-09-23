import { logServerEvent, readFormResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { parseStoreConfigWorkbook, STORE_CONFIG_MAX_BYTES } from "@/lib/store-config-import";
import { buildStoreConfigSections } from "@/lib/store-config-sections";

export const runtime = "nodejs";
const text = (value: unknown) => typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const form = await readFormResponse(request, STORE_CONFIG_MAX_BYTES + 65_536);
  if (form instanceof Response) return form;
  const file = form?.get("file");
  const action = form?.get("action");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")
    || file.size < 1 || file.size > STORE_CONFIG_MAX_BYTES
    || typeof action !== "string" || !["preview", "apply"].includes(action)) {
    return NextResponse.json({ message: "Selecione um XLSX de até 5 MB e uma ação válida." }, { status: 400, headers: privateNoStore });
  }
  try {
    const plan = await parseStoreConfigWorkbook(new Uint8Array(await file.arrayBuffer()));
    if (!plan) return NextResponse.json({ hasConfig: false }, { headers: privateNoStore });
    const required = ["catalog.taxonomy.manage"];
    const permissionResults = await Promise.all(required.map((permissionCode) => auth.supabase.rpc("has_permission", { permission_code: permissionCode })));
    if (permissionResults.some((result) => result.error || result.data !== true)) {
      return NextResponse.json({ message: "Sem permissão para configurar categorias e navegação." }, { status: 403, headers: privateNoStore });
    }
    const homepagePermissions = action === "apply" && plan.options.organizar_home_automaticamente
      ? ["homepage.create", "homepage.edit", ...(plan.options.publicar_home_automaticamente ? ["homepage.publish"] : [])]
      : [];
    const checks = await Promise.all(homepagePermissions.map((p_permission) => auth.supabase.rpc("has_homepage_permission", { p_permission })));
    if (checks.some((result) => result.error || result.data !== true)) {
      return NextResponse.json({ message: "Sem permissão suficiente para aplicar a configuração da home." }, { status: 403, headers: privateNoStore });
    }

    const [sectionsResult, categoriesResult, productsResult, featuredResult, sellersResult] = await Promise.all([
      auth.supabase.from("homepage_sections")
        .select("id,internal_name,section_type,revision,content_config,status")
        .like("internal_name", "xlsx:%").limit(40),
      auth.supabase.rpc("get_home_categories"),
      auth.supabase.rpc("search_catalog", { p_page_size: 1 }),
      auth.supabase.rpc("search_catalog", { p_featured: true, p_page_size: 1 }),
      auth.supabase.rpc("get_homepage_best_sellers", { p_period: "all", p_metric: "units", p_limit: 1, p_fill: false, p_in_stock: true })
    ]);
    if (sectionsResult.error || categoriesResult.error || productsResult.error || featuredResult.error || sellersResult.error) {
      return NextResponse.json({ message: "Não foi possível consultar a configuração atual da loja." }, { status: 503, headers: privateNoStore });
    }
    const currentSections = objectRows(sectionsResult.data);
    const hasCurrentProducts = Array.isArray(record(productsResult.data).products) && (record(productsResult.data).products as unknown[]).length > 0;
    const hasFeatured = Array.isArray(record(featuredResult.data).products) && (record(featuredResult.data).products as unknown[]).length > 0;
    const available = {
      hasSales: objectRows(sellersResult.data).length > 0,
      hasProducts: hasCurrentProducts || plan.hasProducts,
      hasFeatured: hasFeatured || plan.hasProducts,
      hasCategories: objectRows(categoriesResult.data).length > 0 || plan.categories.some((category) => category.active && category.showHome),
      existingBenefits: currentSections.some((section) => section.section_type === "benefits")
    };
    const desired = buildStoreConfigSections(plan, available);
    const changes = desired.map((section) => {
      const existing = currentSections.find((candidate) => candidate.internal_name === section.payload.internalName);
      return { key: section.key, type: section.payload.sectionType,
        action: !existing ? "create" : record(existing.content_config).configHash === section.hash ? "unchanged" : "update" };
    });
    const preview = { hasConfig: true, hasProducts: plan.hasProducts, schemaVersion: "curtiz_store_config_v1",
      categories: plan.categories.map(({ name, slug, showMenu, showHome }) => ({ name, slug, showMenu, showHome })),
      navigation: plan.navigation.map(({ label, destination, visible }) => ({ label, destination, visible })),
      sections: changes, stories: plan.stories.filter((story) => story.active).length,
      faq: plan.faq.filter((entry) => entry.active).length,
      autoPublish: plan.options.publicar_home_automaticamente,
      warnings: [
        ...(!available.hasSales && plan.options.mostrar_mais_vendidos ? ["Mais vendidos será omitido até haver vendas pagas reais."] : []),
        ...(plan.options.publicar_home_automaticamente ? ["Seções alteradas exigem revisão por outra pessoa antes da publicação automática."] : [])
      ] };
    if (action === "preview") return NextResponse.json(preview, { headers: privateNoStore });

    const synced = await auth.supabase.rpc("admin_sync_store_navigation", {
      p_categories: plan.categories.map(({ name, slug, active, showMenu, showHome, sortOrder, description }) =>
        ({ name, slug, active, showMenu, showHome, sortOrder, description })),
      p_items: plan.sheets.navigation ? plan.navigation : null,
      p_sync_menu: plan.options.sincronizar_menu_categorias && (plan.sheets.categories || plan.sheets.navigation)
    });
    if (synced.error) {
      logServerEvent("error", "store_config_navigation_failed", { requestId, code: synced.error.code });
      return NextResponse.json({ ...preview, message: "Não foi possível sincronizar categorias e navegação.", requestId }, { status: 409, headers: privateNoStore });
    }
    const saved: string[] = [];
    for (const section of desired) {
      const existing = currentSections.find((candidate) => candidate.internal_name === section.payload.internalName);
      if (existing && record(existing.content_config).configHash === section.hash) continue;
      const result = await auth.supabase.rpc("save_homepage_section", {
        p_payload: { ...section.payload, ...(existing ? { id: text(existing.id) } : {}) },
        p_expected_revision: existing ? Number(existing.revision) : null
      });
      const savedSectionId: unknown = result.data;
      if (result.error || typeof savedSectionId !== "string") {
        logServerEvent("error", "store_config_section_failed", { requestId, code: result.error?.code ?? "NO_ID", key: section.key });
        return NextResponse.json({ ...preview, saved, requestId,
          message: `Categorias foram sincronizadas, mas a seção ${section.key} não foi salva. Reenvie a planilha para continuar.`
        }, { status: 409, headers: privateNoStore });
      }
      saved.push(section.key);
      if (plan.options.publicar_home_automaticamente) {
        const submitted = await auth.supabase.rpc("transition_homepage_section", {
          p_section_id: savedSectionId, p_action: "submit_review", p_reason: "Configuração automática da loja por planilha"
        });
        if (submitted.error) {
          return NextResponse.json({ ...preview, saved, requestId,
            message: `A seção ${section.key} foi salva, mas não pôde ser enviada para revisão.`
          }, { status: 409, headers: privateNoStore });
        }
      }
    }
    return NextResponse.json({ ...preview, ok: true, saved,
      reviewRequired: plan.options.publicar_home_automaticamente && saved.length > 0,
      message: saved.length ? "Configuração salva no Homepage Builder." : "Configuração já estava atualizada."
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "store_config_parse_failed", { requestId, code: error instanceof Error ? error.message.slice(0, 100) : "unknown" });
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível validar a planilha.", requestId },
      { status: 400, headers: privateNoStore });
  }
}
