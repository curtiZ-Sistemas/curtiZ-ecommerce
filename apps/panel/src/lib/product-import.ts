import "server-only";

import { createHash } from "node:crypto";
import { Workbook, type Cell, type Worksheet } from "exceljs";
import BaseXform from "exceljs/lib/xlsx/xform/base-xform";
import { isAllowedShopeeImageUrl, productImportTaxonomySlug } from "./product-import-session";

export { isAllowedShopeeImageUrl, parseProductImportSessionPayload } from "./product-import-session";

export const PRODUCT_IMPORT_SCHEMA = "curtiz_import_v1";
export const PRODUCT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMPORT_MAX_PRODUCTS = 100;
export const PRODUCT_IMPORT_MAX_VARIANTS = 2_000;
export const PRODUCT_IMPORT_MAX_IMAGES = 1_000;

export type ProductImportIssue = {
  level: "warning" | "error";
  code: string;
  message: string;
  productKey?: string;
};

export type ProductImportVariant = {
  variationKey: string;
  color: string;
  colorHex: string;
  colorHexSecondary: string;
  size: string;
  sku: string;
  active: boolean;
  stock: number;
  priceInCents: number | null;
  costInCents: number | null;
  gtin: string;
  mpn: string;
};

export type ProductImportImage = {
  url: string;
  color: string;
  order: number;
  primary: boolean;
  applyAllSizes: boolean;
};

export type ProductImportProduct = {
  key: string;
  shopeeId: string;
  source: string;
  name: string;
  slug: string;
  categoryName: string;
  categories?: Array<{ name: string; primary: boolean }>;
  modelName: string;
  collectionName: string;
  shortDescription: string;
  description: string;
  featured: boolean;
  priceInCents: number | null;
  compareAtPriceInCents: number | null;
  costInCents: number | null;
  weightGrams: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  merchantCondition: "new" | "refurbished" | "used" | null;
  merchantGender: "male" | "female" | "unisex" | null;
  merchantAgeGroup: "newborn" | "infant" | "toddler" | "kids" | "adult" | null;
  googleProductCategory: string;
  merchantIdentifierExists: boolean | null;
  variants: ProductImportVariant[];
  images: ProductImportImage[];
  sizeGuide: Array<{ size: string; measurementCm: number }>;
  specifications: Array<{ label: string; value: string }>;
  issues: ProductImportIssue[];
};

export type ProductImportBatch = {
  schemaVersion: typeof PRODUCT_IMPORT_SCHEMA;
  products: ProductImportProduct[];
  colorCount: number;
  imageCount: number;
  options: {
    createCategoryIfMissing: boolean;
    createModelIfMissing: boolean;
    associateColorImagesToAllSizes: boolean;
    deduplicateImageDownloadsByUrl: boolean;
  };
  issues: ProductImportIssue[];
};

export type ProductImportReference = {
  categoryId: string | null;
  modelId: string | null;
  collectionId: string | null;
};

export type ProductImportSessionPayload = {
  batch: ProductImportBatch;
  references: Record<string, ProductImportReference>;
};

type SaxEvent = Parameters<BaseXform["parse"]>[0] extends AsyncIterable<infer Events>
  ? Events extends Array<infer Event> ? Event : never
  : never;

const patchKey = Symbol.for("curtiz.exceljs.namespace.compat");
type PatchedGlobal = typeof globalThis & { [patchKey]?: boolean };

function enableExcelJsNamespaceCompatibility() {
  const shared = globalThis as PatchedGlobal;
  if (shared[patchKey]) return;
  BaseXform.prototype.parse = async function patchedParse(parser) {
    for await (const events of parser) {
      for (const event of events) {
        const normalized: SaxEvent = (() => {
          if (event.eventType === "opentag") {
            const name = event.value.name.startsWith("x:") ? event.value.name.slice(2) : event.value.name;
            const attributes = Object.fromEntries(
              Object.entries(event.value.attributes).map(([key, value]) => [key === "xmlns:x" ? "xmlns" : key, value])
            );
            return { ...event, value: { ...event.value, name, attributes } };
          }
          if (event.eventType === "closetag") {
            const name = event.value.name.startsWith("x:") ? event.value.name.slice(2) : event.value.name;
            return { ...event, value: { ...event.value, name } };
          }
          return event;
        })();
        if (normalized.eventType === "opentag") this.parseOpen(normalized.value);
        else if (normalized.eventType === "text") this.parseText(normalized.value);
        else if (!this.parseClose(normalized.value.name)) return this.model;
      }
    }
    return this.model;
  };
  shared[patchKey] = true;
}

type WorkbookXlsxCompat = Workbook["xlsx"] & {
  reconcile(model: { worksheets?: Array<{ tables?: unknown[] }> }, options?: unknown): void;
};

export async function loadWorkbook(bytes: Uint8Array) {
  enableExcelJsNamespaceCompatibility();
  const workbook = new Workbook();
  const xlsx = workbook.xlsx as WorkbookXlsxCompat;
  const reconcile = xlsx.reconcile.bind(xlsx);
  xlsx.reconcile = (model, options) => {
    reconcile(model, options);
    for (const worksheet of model.worksheets ?? []) {
      worksheet.tables = (worksheet.tables ?? []).filter(Boolean);
    }
  };
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
}

const normalizeName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
const scalarText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return `${value}`;
  if (value instanceof Date) return value.toISOString();
  return "";
};
const cleanText = (value: unknown, maximum = 500) => scalarText(value).trim().slice(0, maximum);

function cellValue(cell: Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && "formula" in value) {
    throw new Error(`Fórmulas não são permitidas (${cell.address}).`);
  }
  if (value && typeof value === "object" && "richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return value;
}

export function rows(sheet: Worksheet, maximumRows: number): Array<Record<string, unknown>> {
  if (sheet.actualRowCount < 1 || sheet.actualRowCount - 1 > maximumRows) {
    throw new Error(`A aba ${sheet.name} excede o limite de ${maximumRows} registros.`);
  }
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((value) => cleanText(value, 80));
  if (!headers.length || headers.some((header) => !header)) throw new Error(`A aba ${sheet.name} possui cabeçalho inválido.`);
  const result: Array<Record<string, unknown>> = [];
  for (let rowIndex = 2; rowIndex <= sheet.actualRowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    const record: Record<string, unknown> = {};
    let populated = false;
    headers.forEach((header, index) => {
      const value = cellValue(row.getCell(index + 1));
      if (value !== null && value !== undefined && value !== "") populated = true;
      record[header] = value;
    });
    if (populated) result.push(record);
  }
  return result;
}

const requiredHeaders: Record<string, string[]> = {
  Produtos: ["schema_version", "produto_chave", "shopee_id", "nome", "slug", "categoria", "preco_base"],
  Variacoes: ["produto_chave", "variacao_chave", "cor_nome", "tamanho", "sku", "estoque"],
  Imagens: ["produto_chave", "url", "ordem", "principal", "cor_nome", "aplicar_todos_tamanhos"],
  Cores: ["cor_nome", "hex_principal", "hex_secundario", "hex_terciario"],
  Config: ["chave", "valor"]
};

function assertHeaders(sheet: Worksheet, expected: string[]) {
  const headers = new Set((sheet.getRow(1).values as unknown[]).slice(1).map((value) => cleanText(value, 80)));
  const missing = expected.filter((header) => !headers.has(header));
  if (missing.length) throw new Error(`A aba ${sheet.name} não contém: ${missing.join(", ")}.`);
}

function numberValue(value: unknown, label: string, options: { integer?: boolean; nullable?: boolean; minimum?: number } = {}) {
  const raw = scalarText(value).trim();
  if (!raw) return options.nullable ? null : 0;
  const parsed = typeof value === "number" ? value : Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || (options.integer && !Number.isInteger(parsed)) || parsed < (options.minimum ?? 0)) {
    throw new Error(`${label} possui valor inválido.`);
  }
  return parsed;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeName(scalarText(value));
  if (!normalized) return fallback;
  if (["1", "sim", "true", "ativo"].includes(normalized)) return true;
  if (["0", "nao", "não", "false", "inativo"].includes(normalized)) return false;
  return fallback;
}

function configBoolean(config: Map<string, string>, key: string, fallback: boolean) {
  const value = config.get(key);
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = normalizeName(value);
  if (["1", "sim", "true"].includes(normalized)) return true;
  if (["0", "nao", "não", "false"].includes(normalized)) return false;
  throw new Error(`Config ${key} deve usar SIM/NAO, true/false ou 1/0.`);
}

const cents = (value: unknown, label: string) => {
  const parsed = numberValue(value, label, { nullable: true, minimum: 0 });
  return parsed === null ? null : Math.round(parsed * 100);
};

export function generatedImportSku(productKey: string, color: string, size: string) {
  const source = `${productKey}-${color}-${size}`;
  const base = productImportTaxonomySlug(source).toUpperCase().slice(0, 92) || "PRODUTO";
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 8).toUpperCase();
  return `${base}-${hash}`;
}

function enumValue<T extends string>(value: unknown, accepted: readonly T[]): T | null {
  const candidate = cleanText(value, 40) as T;
  return accepted.includes(candidate) ? candidate : null;
}

function productIssue(product: ProductImportProduct, level: ProductImportIssue["level"], code: string, message: string) {
  if (product.issues.some((issue) => issue.level === level && issue.code === code && issue.message === message)) return;
  product.issues.push({ level, code, message, productKey: product.key });
}

export async function parseProductImportWorkbook(input: ArrayBuffer | Uint8Array): Promise<ProductImportBatch> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.byteLength || bytes.byteLength > PRODUCT_IMPORT_MAX_BYTES) throw new Error("Envie um XLSX de até 5 MB.");
  const workbook = await loadWorkbook(bytes);
  const requiredSheets = ["Config", "Produtos", "Variacoes", "Imagens", "Cores"];
  for (const name of requiredSheets) {
    if (!workbook.getWorksheet(name)) throw new Error(`A aba obrigatória ${name} não foi encontrada.`);
  }
  for (const [name, expected] of Object.entries(requiredHeaders)) assertHeaders(workbook.getWorksheet(name)!, expected);

  const config = new Map(rows(workbook.getWorksheet("Config")!, 100)
    .map((row) => [normalizeName(cleanText(row.chave, 80)), cleanText(row.valor, 200)]));
  if (config.get("schema_version") !== PRODUCT_IMPORT_SCHEMA) throw new Error(`schema_version deve ser ${PRODUCT_IMPORT_SCHEMA}.`);
  const options: ProductImportBatch["options"] = {
    createCategoryIfMissing: configBoolean(config, "criar_categoria_se_ausente", false),
    createModelIfMissing: configBoolean(config, "criar_modelo_se_ausente", false),
    associateColorImagesToAllSizes: configBoolean(config, "associar_imagem_cor_a_todos_tamanhos", true),
    deduplicateImageDownloadsByUrl: configBoolean(config, "deduplicar_download_imagem_por_url", true)
  };

  const colorRows = rows(workbook.getWorksheet("Cores")!, 500);
  const colors = new Map<string, { name: string; primary: string; secondary: string; tertiary: string }>();
  for (const row of colorRows) {
    const name = cleanText(row.cor_nome, 80);
    const primary = cleanText(row.hex_principal, 7);
    const secondary = cleanText(row.hex_secundario, 7);
    const tertiary = cleanText(row.hex_terciario, 7);
    const useSecondaryValue = cleanText(row.usar_cor_secundaria, 10);
    const normalizedSecondaryFlag = normalizeName(useSecondaryValue);
    if (normalizedSecondaryFlag && !["1", "sim", "true", "0", "nao", "false"].includes(normalizedSecondaryFlag)) {
      throw new Error(`A cor ${name || "sem nome"} deve usar SIM ou NAO em usar_cor_secundaria.`);
    }
    const useSecondary = useSecondaryValue ? booleanValue(useSecondaryValue) : Boolean(secondary);
    if (!name || !/^#[0-9a-f]{6}$/iu.test(primary) || (useSecondary && !/^#[0-9a-f]{6}$/iu.test(secondary))) {
      throw new Error(`A cor ${name || "sem nome"} precisa de HEX principal válido${useSecondary ? " e HEX secundário válido" : ""}.`);
    }
    const normalizedPrimary = primary.toUpperCase();
    const normalizedSecondary = useSecondary && secondary.toUpperCase() !== normalizedPrimary ? secondary.toUpperCase() : "";
    colors.set(normalizeName(name), { name, primary: normalizedPrimary, secondary: normalizedSecondary, tertiary: tertiary.toUpperCase() });
  }

  const productRows = rows(workbook.getWorksheet("Produtos")!, PRODUCT_IMPORT_MAX_PRODUCTS);
  const products = new Map<string, ProductImportProduct>();
  const issues: ProductImportIssue[] = [];
  for (const row of productRows) {
    const key = cleanText(row.produto_chave, 120);
    if (!key || products.has(key)) throw new Error(`produto_chave ausente ou duplicado: ${key || "linha sem chave"}.`);
    if (cleanText(row.schema_version, 40) !== PRODUCT_IMPORT_SCHEMA) throw new Error(`Produto ${key} possui schema_version incorreto.`);
    const name = cleanText(row.nome, 160);
    const product: ProductImportProduct = {
      key,
      shopeeId: cleanText(row.shopee_id, 120),
      source: productImportTaxonomySlug(cleanText(row.origem, 40)) || "shopee",
      name,
      slug: productImportTaxonomySlug(cleanText(row.slug, 180) || name),
      categoryName: cleanText(row.categoria, 120),
      categories: [],
      modelName: cleanText(row.modelo, 120),
      collectionName: cleanText(row.colecao, 120),
      shortDescription: cleanText(row.descricao_curta, 280),
      description: cleanText(row.descricao, 4_000),
      featured: booleanValue(row.destaque),
      priceInCents: cents(row.preco_base, `preco_base de ${key}`),
      compareAtPriceInCents: cents(row.preco_original, `preco_original de ${key}`),
      costInCents: cents(row.custo, `custo de ${key}`),
      weightGrams: numberValue(row.peso_g, `peso_g de ${key}`, { integer: true, nullable: true, minimum: 1 }),
      heightCm: numberValue(row.altura_cm, `altura_cm de ${key}`, { nullable: true, minimum: 0.01 }),
      widthCm: numberValue(row.largura_cm, `largura_cm de ${key}`, { nullable: true, minimum: 0.01 }),
      lengthCm: numberValue(row.comprimento_cm, `comprimento_cm de ${key}`, { nullable: true, minimum: 0.01 }),
      merchantCondition: enumValue(row.condicao, ["new", "refurbished", "used"] as const),
      merchantGender: enumValue(row.genero, ["male", "female", "unisex"] as const),
      merchantAgeGroup: enumValue(row.faixa_etaria, ["newborn", "infant", "toddler", "kids", "adult"] as const),
      googleProductCategory: cleanText(row.google_product_category, 500),
      merchantIdentifierExists: row.identificador_existe === null || row.identificador_existe === undefined || row.identificador_existe === ""
        ? null : booleanValue(row.identificador_existe),
      variants: [], images: [], sizeGuide: [], specifications: [], issues: []
    };
    if (name.length < 3 || !product.slug) productIssue(product, "error", "INVALID_PRODUCT", "Nome ou slug inválido.");
    if (!product.categoryName) productIssue(product, "error", "CATEGORY_REQUIRED", "Informe a categoria.");
    products.set(key, product);
  }

  const variantRows = rows(workbook.getWorksheet("Variacoes")!, PRODUCT_IMPORT_MAX_VARIANTS);
  const usedSkus = new Set<string>();
  for (const row of variantRows) {
    const key = cleanText(row.produto_chave, 120);
    const product = products.get(key);
    if (!product) { issues.push({ level: "error", code: "UNKNOWN_PRODUCT", message: `Variação referencia produto inexistente: ${key}.` }); continue; }
    const colorName = cleanText(row.cor_nome, 80);
    const color = colors.get(normalizeName(colorName));
    if (!color) { productIssue(product, "error", "UNKNOWN_COLOR", `Cor não cadastrada na aba Cores: ${colorName}.`); continue; }
    const size = cleanText(row.tamanho, 40);
    if (!size) productIssue(product, "error", "SIZE_REQUIRED", "Uma variação está sem tamanho.");
    let sku = cleanText(row.sku, 140) || generatedImportSku(key, color.name, size);
    const normalizedSku = sku.toLocaleUpperCase("pt-BR");
    if (usedSkus.has(normalizedSku)) {
      productIssue(product, "error", "DUPLICATE_SKU", `SKU duplicado no arquivo: ${sku}.`);
      sku = `${sku.slice(0, 130)}-${product.variants.length + 1}`;
    }
    usedSkus.add(sku.toLocaleUpperCase("pt-BR"));
    if (color.tertiary) productIssue(product, "warning", "TERTIARY_COLOR_IGNORED", `A terceira cor de ${color.name} não é suportada e foi ignorada.`);
    product.variants.push({
      variationKey: cleanText(row.variacao_chave, 160), color: color.name,
      colorHex: color.primary, colorHexSecondary: color.secondary, size, sku,
      active: booleanValue(row.ativo, true),
      stock: numberValue(row.estoque, `estoque de ${key}`, { integer: true, minimum: 0 }) ?? 0,
      priceInCents: cents(row.preco_override, `preco_override de ${key}`),
      costInCents: cents(row.custo_override, `custo_override de ${key}`),
      gtin: cleanText(row.gtin, 50), mpn: cleanText(row.mpn, 70)
    });
  }

  const imageRows = rows(workbook.getWorksheet("Imagens")!, PRODUCT_IMPORT_MAX_IMAGES);
  for (const row of imageRows) {
    const key = cleanText(row.produto_chave, 120);
    const product = products.get(key);
    if (!product) { issues.push({ level: "warning", code: "UNKNOWN_IMAGE_PRODUCT", message: `Imagem referencia produto inexistente: ${key}.` }); continue; }
    const url = cleanText(row.url, 2_048);
    if (!isAllowedShopeeImageUrl(url)) { productIssue(product, "warning", "IMAGE_URL_REJECTED", `URL de imagem não permitida foi ignorada.`); continue; }
    const colorName = cleanText(row.cor_nome, 80);
    const color = colorName ? colors.get(normalizeName(colorName)) : null;
    if (colorName && !color) productIssue(product, "warning", "UNKNOWN_IMAGE_COLOR", `A imagem usa uma cor desconhecida: ${colorName}.`);
    const image: ProductImportImage = {
      url, color: color?.name ?? "",
      order: numberValue(row.ordem, `ordem de imagem de ${key}`, { integer: true, minimum: 0 }) ?? product.images.length,
      primary: booleanValue(row.principal),
      applyAllSizes: options.associateColorImagesToAllSizes && booleanValue(row.aplicar_todos_tamanhos, options.associateColorImagesToAllSizes)
    };
    product.images.push(image);
  }

  const sizeSheet = workbook.getWorksheet("Tabela_Tamanhos");
  if (sizeSheet) {
    assertHeaders(sizeSheet, ["produto_chave", "tamanho", "medida_cm"]);
    const knownSizes = new Map<string, Set<string>>();
    for (const row of rows(sizeSheet, 1_000)) {
      const product = products.get(cleanText(row.produto_chave, 120));
      if (!product) continue;
      const size = cleanText(row.tamanho, 40);
      const measurementCm = numberValue(row.medida_cm, `medida_cm de ${product.key}`, { nullable: true, minimum: 0.01 });
      const normalizedSize = normalizeName(size);
      const productSizes = knownSizes.get(product.key) ?? new Set<string>();
      knownSizes.set(product.key, productSizes);
      if (size && measurementCm !== null && !productSizes.has(normalizedSize)) {
        productSizes.add(normalizedSize);
        product.sizeGuide.push({ size, measurementCm });
      }
    }
  }
  const specificationSheet = workbook.getWorksheet("Especificacoes");
  if (specificationSheet) {
    assertHeaders(specificationSheet, ["produto_chave", "campo", "valor"]);
    for (const row of rows(specificationSheet, 1_000)) {
      const product = products.get(cleanText(row.produto_chave, 120));
      if (!product) continue;
      const label = cleanText(row.campo, 80);
      const value = cleanText(row.valor, 500);
      if (label && value) product.specifications.push({ label, value });
    }
  }

  const productCategoriesSheet = workbook.getWorksheet("Produto_Categorias");
  if (productCategoriesSheet) {
    assertHeaders(productCategoriesSheet, ["produto_chave", "categoria", "primaria"]);
    for (const row of rows(productCategoriesSheet, 1_000)) {
      const key = cleanText(row.produto_chave, 120);
      const product = products.get(key);
      if (!product) {
        issues.push({ level: "error", code: "UNKNOWN_CATEGORY_PRODUCT", message: `Categoria referencia produto inexistente: ${key}.` });
        continue;
      }
      const name = cleanText(row.categoria, 120);
      if (!name) {
        productIssue(product, "error", "CATEGORY_REQUIRED", "Informe a categoria em Produto_Categorias.");
        continue;
      }
      if (product.categories?.some((category) => normalizeName(category.name) === normalizeName(name))) {
        productIssue(product, "error", "DUPLICATE_CATEGORY", `A categoria ${name} está repetida para este produto.`);
        continue;
      }
      const primaryValue = normalizeName(cleanText(row.primaria, 10));
      if (!["sim", "nao", "não", "true", "false", "1", "0"].includes(primaryValue)) {
        productIssue(product, "error", "INVALID_PRIMARY_CATEGORY", `A categoria ${name} deve informar primaria como SIM ou NAO.`);
        continue;
      }
      product.categories?.push({ name, primary: booleanValue(row.primaria) });
    }
  }

  for (const product of products.values()) {
    if (!product.categories?.length) product.categories = [{ name: product.categoryName, primary: true }];
    const primaryCategories = product.categories.filter((category) => category.primary);
    if (primaryCategories.length !== 1) productIssue(product, "error", "PRIMARY_CATEGORY_REQUIRED", "Informe exatamente uma categoria primária.");
    else product.categoryName = primaryCategories[0]!.name;
    product.images.sort((left, right) => left.order - right.order);
    if (!product.variants.length) productIssue(product, "error", "VARIANTS_REQUIRED", "Nenhuma variação válida encontrada.");
  }
  return { schemaVersion: PRODUCT_IMPORT_SCHEMA, products: [...products.values()], colorCount: colors.size, imageCount: imageRows.length, options, issues };
}

export function productImportPreview(batch: ProductImportBatch) {
  const allIssues = [...batch.issues, ...batch.products.flatMap((product) => product.issues)];
  return {
    schemaVersion: batch.schemaVersion,
    summary: {
      products: batch.products.length,
      variations: batch.products.reduce((total, product) => total + product.variants.length, 0),
      images: batch.imageCount,
      colors: batch.colorCount,
      warnings: allIssues.filter((issue) => issue.level === "warning").length,
      errors: allIssues.filter((issue) => issue.level === "error").length
    },
    products: batch.products.map((product) => ({
      key: product.key, name: product.name, category: product.categoryName,
      variations: product.variants.length, images: product.images.length,
      warnings: product.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message),
      errors: product.issues.filter((issue) => issue.level === "error").map((issue) => issue.message)
    })),
    issues: batch.issues
  };
}
