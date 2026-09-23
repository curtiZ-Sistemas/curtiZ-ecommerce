import "server-only";

import type { Worksheet } from "exceljs";
import { loadWorkbook, rows } from "./product-import";
import { productImportTaxonomySlug } from "./product-import-session";

export const STORE_CONFIG_SCHEMA = "curtiz_store_config_v1";
export const STORE_CONFIG_MAX_BYTES = 5 * 1024 * 1024;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const allowedSectionTypes = new Set([
  "categories_grid", "best_sellers", "featured_products", "recommended_products",
  "launches", "institutional", "faq", "benefits", "newsletter", "reviews_carousel"
]);
const optionNames = [
  "sincronizar_menu_categorias", "organizar_home_automaticamente", "publicar_home_automaticamente",
  "mostrar_categorias_home", "mostrar_mais_vendidos", "mostrar_destaques", "mostrar_novidades",
  "mostrar_recomendados", "mostrar_storytelling", "mostrar_faq", "mostrar_beneficios"
] as const;
type OptionName = typeof optionNames[number];

export type StoreConfigCategory = {
  key: string; name: string; slug: string; active: boolean; showMenu: boolean;
  showHome: boolean; sortOrder: number; description: string;
};
export type StoreConfigNavigation = {
  key: string; label: string; type: "page" | "category" | "collection";
  destination: string; sortOrder: number; visible: boolean;
};
export type StoreConfigHomeSection = {
  key: string; type: string; title: string; subtitle: string; active: boolean;
  source: string; limit: number; sortOrder: number;
};
export type StoreConfigStory = {
  key: string; title: string; subtitle: string; text: string;
  ctaText: string; ctaDestination: string; sortOrder: number; active: boolean;
};
export type StoreConfigFaq = {
  key: string; question: string; answer: string; sortOrder: number; active: boolean;
};
export type StoreConfigPlan = {
  hasProducts: boolean;
  sheets: { categories: boolean; navigation: boolean };
  options: Record<OptionName, boolean>;
  categories: StoreConfigCategory[];
  navigation: StoreConfigNavigation[];
  homeSections: StoreConfigHomeSection[];
  stories: StoreConfigStory[];
  faq: StoreConfigFaq[];
};

function plain(value: unknown, label: string, maximum: number, required = false): string {
  const result = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim() : "";
  if (result.length > maximum || /[<>]/u.test(result)
    || Array.from(result).some((char) => (char.codePointAt(0) ?? 0) < 32) || (required && !result)) {
    throw new Error(`${label} é inválido ou contém marcação não permitida.`);
  }
  return result;
}

function flag(value: unknown, label: string, fallback = false): boolean {
  const normalized = plain(value, label, 10).normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  if (!normalized) return fallback;
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["nao", "false", "0"].includes(normalized)) return false;
  throw new Error(`${label} deve usar SIM ou NAO.`);
}

function order(value: unknown, label: string, fallback = 0): number {
  const raw = plain(value, label, 8);
  if (!raw) return fallback;
  const result = Number(raw);
  if (!Number.isInteger(result) || result < 0 || result > 10000) throw new Error(`${label} deve ser inteiro entre 0 e 10000.`);
  return result;
}

function safeRoute(value: unknown, label: string): string {
  const route = plain(value, label, 500, true);
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("..") || /[?#].*[<>]/u.test(route)) {
    throw new Error(`${label} deve ser uma rota interna segura.`);
  }
  return route;
}

function readSheet(sheet: Worksheet | undefined, headers: string[], limit: number) {
  if (!sheet) return [];
  const present = new Set((sheet.getRow(1).values as unknown[]).slice(1)
    .map((item) => typeof item === "string" ? item.trim() : ""));
  const missing = headers.filter((header) => !present.has(header));
  if (missing.length) throw new Error(`A aba ${sheet.name} não contém: ${missing.join(", ")}.`);
  return rows(sheet, limit);
}

function uniqueKeys<T extends { key: string }>(items: T[], label: string) {
  if (new Set(items.map((item) => item.key)).size !== items.length) throw new Error(`A aba ${label} contém chaves duplicadas.`);
  return items;
}

export async function parseStoreConfigWorkbook(input: Uint8Array): Promise<StoreConfigPlan | null> {
  if (!input.byteLength || input.byteLength > STORE_CONFIG_MAX_BYTES) throw new Error("Envie um XLSX de até 5 MB.");
  const workbook = await loadWorkbook(input);
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.value && typeof cell.value === "object" && "formula" in cell.value) {
        throw new Error(`Fórmulas não são permitidas (${sheet.name}!${cell.address}).`);
      }
    }));
  }
  const configSheet = workbook.getWorksheet("Loja_Config");
  const hasConfig = ["Categorias", "Navegacao", "Home_Ordem", "Storytelling", "FAQ"]
    .some((name) => Boolean(workbook.getWorksheet(name)));
  if (!configSheet && !hasConfig) return null;
  const configRows = readSheet(configSheet, ["chave", "valor"], 100);
  const config = new Map(configRows.map((row) => [plain(row.chave, "Loja_Config.chave", 80, true), row.valor]));
  if (configSheet && config.get("schema_version") !== STORE_CONFIG_SCHEMA) {
    throw new Error(`Loja_Config.schema_version deve ser ${STORE_CONFIG_SCHEMA}.`);
  }
  const options = Object.fromEntries(optionNames.map((name) => [name, flag(config.get(name), `Loja_Config.${name}`)])) as Record<OptionName, boolean>;
  const categories = uniqueKeys(readSheet(workbook.getWorksheet("Categorias"),
    ["categoria_chave", "nome", "slug", "ativa", "mostrar_menu", "mostrar_home", "ordem"], 100).map((row) => {
    const key = plain(row.categoria_chave, "Categorias.categoria_chave", 80, true);
    const name = plain(row.nome, "Categorias.nome", 120, true);
    const slug = plain(row.slug, "Categorias.slug", 180, true);
    if (!slugPattern.test(slug) || slug !== productImportTaxonomySlug(name)) throw new Error(`Slug inválido para a categoria ${name}.`);
    return { key, name, slug, active: flag(row.ativa, "Categorias.ativa"),
      showMenu: flag(row.mostrar_menu, "Categorias.mostrar_menu"),
      showHome: flag(row.mostrar_home, "Categorias.mostrar_home"),
      sortOrder: order(row.ordem, "Categorias.ordem"),
      description: plain(row.descricao, "Categorias.descricao", 1000) };
  }), "Categorias");
  if (new Set(categories.map((item) => item.slug)).size !== categories.length) throw new Error("Categorias contém slugs duplicados.");
  const navigation = uniqueKeys(readSheet(workbook.getWorksheet("Navegacao"),
    ["chave", "label", "tipo", "destino", "ordem", "visivel"], 100).flatMap((row): StoreConfigNavigation[] => {
    if (row.gerenciado_por_planilha !== undefined && !flag(row.gerenciado_por_planilha, "Navegacao.gerenciado_por_planilha", true)) return [];
    const type = plain(row.tipo, "Navegacao.tipo", 20, true);
    if (type !== "page" && type !== "category" && type !== "collection") throw new Error("Navegacao.tipo deve ser page, category ou collection.");
    const destination = type === "page" ? safeRoute(row.destino, "Navegacao.destino") : plain(row.destino, "Navegacao.destino", 180, true);
    if (type !== "page" && !slugPattern.test(destination)) throw new Error("Destino de categoria/coleção inválido.");
    return [{ key: plain(row.chave, "Navegacao.chave", 80, true),
      label: plain(row.label, "Navegacao.label", 60, true), type, destination,
      sortOrder: order(row.ordem, "Navegacao.ordem"), visible: flag(row.visivel, "Navegacao.visivel") }];
  }), "Navegacao");
  if (new Set(navigation.map((item) => `${item.type}:${item.destination}`)).size !== navigation.length) {
    throw new Error("Navegacao contém destinos duplicados.");
  }
  const homeSections = uniqueKeys(readSheet(workbook.getWorksheet("Home_Ordem"),
    ["ordem", "chave", "tipo", "titulo", "subtitulo", "ativo", "fonte", "limite"], 40).map((row) => {
    const type = plain(row.tipo, "Home_Ordem.tipo", 50, true);
    if (!allowedSectionTypes.has(type)) throw new Error(`Tipo de seção não suportado: ${type}.`);
    const limit = order(row.limite, "Home_Ordem.limite", 8);
    if (limit < 1 || limit > 24) throw new Error("Home_Ordem.limite deve ficar entre 1 e 24.");
    return { key: plain(row.chave, "Home_Ordem.chave", 80, true), type,
      title: plain(row.titulo, "Home_Ordem.titulo", 160), subtitle: plain(row.subtitulo, "Home_Ordem.subtitulo", 240),
      active: flag(row.ativo, "Home_Ordem.ativo"), source: plain(row.fonte, "Home_Ordem.fonte", 80),
      limit, sortOrder: order(row.ordem, "Home_Ordem.ordem") };
  }), "Home_Ordem");
  const stories = uniqueKeys(readSheet(workbook.getWorksheet("Storytelling"),
    ["chave", "titulo", "subtitulo", "texto", "cta_texto", "cta_destino", "ordem", "ativo"], 12).map((row) => ({
      key: plain(row.chave, "Storytelling.chave", 80, true),
      title: plain(row.titulo, "Storytelling.titulo", 160, true),
      subtitle: plain(row.subtitulo, "Storytelling.subtitulo", 240),
      text: plain(row.texto, "Storytelling.texto", 2000, true),
      ctaText: plain(row.cta_texto, "Storytelling.cta_texto", 80),
      ctaDestination: row.cta_destino ? safeRoute(row.cta_destino, "Storytelling.cta_destino") : "",
      sortOrder: order(row.ordem, "Storytelling.ordem"), active: flag(row.ativo, "Storytelling.ativo")
    })), "Storytelling");
  const faq = uniqueKeys(readSheet(workbook.getWorksheet("FAQ"),
    ["chave", "pergunta", "resposta", "ordem", "ativo"], 24).map((row) => ({
      key: plain(row.chave, "FAQ.chave", 80, true), question: plain(row.pergunta, "FAQ.pergunta", 160, true),
      answer: plain(row.resposta, "FAQ.resposta", 2000, true),
      sortOrder: order(row.ordem, "FAQ.ordem"), active: flag(row.ativo, "FAQ.ativo")
    })), "FAQ");
  return { hasProducts: Boolean(workbook.getWorksheet("Produtos")),
    sheets: { categories: Boolean(workbook.getWorksheet("Categorias")), navigation: Boolean(workbook.getWorksheet("Navegacao")) },
    options, categories,
    navigation, homeSections, stories, faq };
}
