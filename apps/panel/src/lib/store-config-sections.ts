import { createHash } from "node:crypto";
import type { StoreConfigPlan } from "./store-config-import";

export type ManagedHomeSection = {
  key: string;
  hash: string;
  payload: Record<string, unknown>;
};

export type StoreConfigSectionAction = "create" | "update" | "unchanged" | "archive" | "restore";

export type ExistingManagedHomeSection = {
  id: string;
  internal_name: string;
  section_type: string;
  revision: number;
  content_config: unknown;
  status: string;
};

export type StoreConfigSectionChange = {
  key: string;
  type: string;
  action: StoreConfigSectionAction;
  desired?: ManagedHomeSection;
  existing?: ExistingManagedHomeSection;
};

const configHash = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? (value as Record<string, unknown>).configHash : undefined;

export function planStoreConfigSectionChanges(
  desired: readonly ManagedHomeSection[],
  existing: readonly ExistingManagedHomeSection[]
): StoreConfigSectionChange[] {
  const desiredNames = new Set(desired.map((section) => String(section.payload.internalName ?? "")));
  const changes = desired.map((section): StoreConfigSectionChange => {
    const internalName = String(section.payload.internalName ?? "");
    const matches = existing.filter((candidate) => candidate.internal_name === internalName);
    const current = matches.find((candidate) => candidate.status !== "archived") ?? matches[0];
    return {
      key: section.key,
      type: String(section.payload.sectionType ?? ""),
      action: !current ? "create"
        : current.status === "archived" ? "restore"
          : configHash(current.content_config) === section.hash ? "unchanged" : "update",
      desired: section,
      ...(current ? { existing: current } : {})
    };
  });

  for (const section of existing) {
    if (!section.internal_name.startsWith("xlsx:") || desiredNames.has(section.internal_name)
      || section.status === "archived") continue;
    changes.push({ key: section.internal_name.slice("xlsx:".length), type: section.section_type,
      action: "archive", existing: section });
  }
  return changes;
}

const item = (key: string, title: string, description: string, sortOrder: number,
  route = "", itemType = "content") => ({
  itemType, internalName: key, title, description, decorative: false,
  targetType: route ? "page" : "none", ...(route ? { targetRoute: route } : {}),
  sortOrder, config: {}, media: []
});

export function buildStoreConfigSections(plan: StoreConfigPlan, available: {
  hasSales: boolean; hasProducts: boolean; hasFeatured: boolean; hasCategories: boolean;
  existingBenefits: boolean;
}): ManagedHomeSection[] {
  if (!plan.options.organizar_home_automaticamente) return [];
  const sections: ManagedHomeSection[] = [];
  for (const row of [...plan.homeSections].sort((left, right) => left.sortOrder - right.sortOrder)) {
    if (!row.active) continue;
    const enabled = row.type === "categories_grid" ? plan.options.mostrar_categorias_home && available.hasCategories
      : row.type === "best_sellers" ? plan.options.mostrar_mais_vendidos && available.hasSales
      : row.type === "featured_products" ? plan.options.mostrar_destaques && available.hasFeatured
      : row.type === "recommended_products" ? plan.options.mostrar_recomendados && available.hasProducts
      : row.type === "launches" ? plan.options.mostrar_novidades && available.hasProducts
      : row.type === "institutional" ? plan.options.mostrar_storytelling && plan.stories.some((story) => story.active)
      : row.type === "faq" ? plan.options.mostrar_faq && plan.faq.some((entry) => entry.active)
      : row.type === "benefits" ? plan.options.mostrar_beneficios && available.existingBenefits
      : row.type === "reviews_carousel" || row.type === "newsletter" ? false : false;
    if (!enabled || row.type === "benefits") continue; // Existing manual benefits remain owned by the builder.
    const story = row.type === "institutional" ? [...plan.stories].filter((entry) => entry.active)
      .sort((left, right) => left.sortOrder - right.sortOrder)[0] : undefined;
    const items = row.type === "faq"
      ? [...plan.faq].filter((entry) => entry.active).sort((left, right) => left.sortOrder - right.sortOrder)
        .map((entry) => item(entry.key, entry.question, entry.answer, entry.sortOrder, "", "faq"))
      : story ? [item(story.key, story.ctaText, "", 0, story.ctaDestination)] : [];
    const content: Record<string, unknown> = {
      source: row.type === "recommended_products" ? "personalized" : "automatic",
      limit: row.limit,
      ...(row.type === "best_sellers" ? { salesPeriod: "all", rankingMetric: "units", fillEmptySlots: false,
        excludeOutOfStock: true } : {}),
      autoPublishAfterApproval: plan.options.publicar_home_automaticamente
    };
    const base = {
      internalName: `xlsx:${row.key}`, sectionType: row.type,
      title: story?.title ?? row.title,
      subtitle: story?.subtitle ?? row.subtitle,
      description: story?.text ?? "",
      layout: row.type === "categories_grid" || row.type === "best_sellers" || row.type === "recommended_products"
        || row.type === "launches" || row.type === "featured_products" ? "carousel" : "content_centered",
      visibility: "all", style: {}, content, sortOrder: row.sortOrder, items
    };
    const hash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    sections.push({ key: row.key, hash, payload: {
      ...base, content: { ...content, configHash: hash }, changeSummary: "Sincronização da planilha de configuração da loja"
    } });
  }
  return sections;
}
