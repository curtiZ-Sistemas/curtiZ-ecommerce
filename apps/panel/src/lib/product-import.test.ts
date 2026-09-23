import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";

vi.mock("server-only", () => ({}));

import {
  PRODUCT_IMPORT_SCHEMA,
  generatedImportSku,
  isAllowedShopeeImageUrl,
  parseProductImportSessionPayload,
  parseProductImportWorkbook,
  productImportPreview
} from "./product-import";
import { runProductImportBatches, runProductImportQueue } from "./product-import-client";
import { normalizeProductImportImageUrl, prepareProductImportImages } from "./product-import-images";

const fixture = readFileSync("../../docs/import/curtiz_importacao_produtos_shopee_COMPLETA.xlsx");

async function minimalWorkbook(schemaVersion = PRODUCT_IMPORT_SCHEMA, withOptionalData = false, configRows: unknown[][] = [], change?: (workbook: Workbook) => void) {
  const workbook = new Workbook();
  workbook.addWorksheet("Config").addRows([["chave", "valor"], ["schema_version", schemaVersion], ...configRows]);
  workbook.addWorksheet("Produtos").addRows([
    ["schema_version", "produto_chave", "shopee_id", "nome", "slug", "categoria", "preco_base", "descricao", "descricao_curta", "custo", "peso_g", "altura_cm", "largura_cm", "comprimento_cm"],
    [schemaVersion, "PROD-1", "1", "Produto mínimo", "produto-minimo", "Chinelos", 10, "", "", withOptionalData ? 8.35 : "", withOptionalData ? 300 : "", withOptionalData ? 8 : "", withOptionalData ? 20 : "", withOptionalData ? 28 : ""]
  ]);
  workbook.addWorksheet("Cores").addRows([
    ["cor_nome", "hex_principal", "hex_secundario", "hex_terciario"],
    ["Lilás", "#C8A2C8", "", ""]
  ]);
  workbook.addWorksheet("Variacoes").addRows([
    ["produto_chave", "variacao_chave", "cor_nome", "tamanho", "sku", "ativo", "estoque", "preco_override", "custo_override", "gtin", "mpn"],
    ["PROD-1", "VAR-1", "Lilás", "35", "", true, "", withOptionalData ? 12.9 : "", withOptionalData ? 9.55 : "", "", ""]
  ]);
  workbook.addWorksheet("Imagens").addRow(["produto_chave", "url", "ordem", "principal", "cor_nome", "aplicar_todos_tamanhos"]);
  if (withOptionalData) {
    workbook.addWorksheet("Tabela_Tamanhos").addRows([
      ["produto_chave", "tamanho", "medida_cm"],
      ["PROD-1", "35", 23.5],
      ["PROD-1", "35", 99]
    ]);
    workbook.addWorksheet("Especificacoes").addRows([
      ["produto_chave", "campo", "valor"],
      ["PROD-1", "Material", "Borracha"],
      ["PROD-1", "Origem", "Brasil"]
    ]);
  }
  change?.(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("product XLSX import", () => {
  it("reads the official curtiz_import_v1 fixture", async () => {
    const batch = await parseProductImportWorkbook(fixture);
    const products = batch.products;
    const variants = products.flatMap((product) => product.variants);
    expect(batch.schemaVersion).toBe(PRODUCT_IMPORT_SCHEMA);
    expect(products).toHaveLength(12);
    expect(variants).toHaveLength(408);
    expect(products.reduce((total, product) => total + prepareProductImportImages(product.images).images.length, 0)).toBe(169);
    expect(productImportPreview(batch).summary.images).toBe(169);
    expect(batch.colorCount).toBe(30);
    expect(batch.options).toEqual({
      createCategoryIfMissing: true,
      createModelIfMissing: true,
      associateColorImagesToAllSizes: true,
      deduplicateImageDownloadsByUrl: true
    });
    expect(variants.every((variant) => variant.stock === 1_000)).toBe(true);
    expect(products.filter((product) => product.costInCents !== null)).toHaveLength(12);
    expect(products.filter((product) => product.weightGrams !== null && product.heightCm !== null
      && product.widthCm !== null && product.lengthCm !== null)).toHaveLength(12);
    expect(products.reduce((total, product) => total + product.sizeGuide.length, 0)).toBe(72);
    expect(products.reduce((total, product) => total + product.specifications.length, 0)).toBe(84);
    expect(products.every((product) => product.googleProductCategory === "Apparel & Accessories > Shoes > Sandals")).toBe(true);
    expect(products.every((product) => product.name.length >= 3 && product.description.length > 0 && product.shortDescription.length > 0)).toBe(true);
  });

  it("keeps optional empty fields nullable, empty stock at zero, colors and stable generated SKU", async () => {
    const batch = await parseProductImportWorkbook(await minimalWorkbook());
    const product = batch.products[0]!;
    expect(product).toMatchObject({ description: "", shortDescription: "", costInCents: null, weightGrams: null, sizeGuide: [], specifications: [] });
    expect(product.variants[0]).toMatchObject({ stock: 0, color: "Lilás", colorHex: "#C8A2C8", colorHexSecondary: "" });
    expect(product.variants[0]?.sku).toBe(generatedImportSku("PROD-1", "Lilás", "35"));
  });

  it("preserves color image associations and imports the optional product sheets", async () => {
    const batch = await parseProductImportWorkbook(fixture);
    expect(batch.products.flatMap((product) => product.images).some((image) => image.color && image.applyAllSizes)).toBe(true);
    expect(batch.products.reduce((total, product) => total + product.sizeGuide.length, 0)).toBe(72);
    expect(batch.products.reduce((total, product) => total + product.specifications.length, 0)).toBe(84);
  });

  it("reads valid size guide and specification rows from optional sheets", async () => {
    const product = (await parseProductImportWorkbook(await minimalWorkbook(PRODUCT_IMPORT_SCHEMA, true))).products[0]!;
    expect(product.sizeGuide).toEqual([{ size: "35", measurementCm: 23.5 }]);
    expect(product.specifications).toEqual([
      { label: "Material", value: "Borracha" },
      { label: "Origem", value: "Brasil" }
    ]);
    expect(product).toMatchObject({ costInCents: 835, weightGrams: 300, heightCm: 8, widthCm: 20, lengthCm: 28 });
    expect(product.variants[0]).toMatchObject({ priceInCents: 1_290, costInCents: 955 });
  });

  it("reads additional categories and explicit one/two-color flags", async () => {
    const bytes = await minimalWorkbook(PRODUCT_IMPORT_SCHEMA, false, [], (workbook) => {
      workbook.addWorksheet("Produto_Categorias").addRows([
        ["produto_chave", "categoria", "primaria"],
        ["PROD-1", "Chinelos", "SIM"], ["PROD-1", "Feminino", "NAO"]
      ]);
      const colors = workbook.getWorksheet("Cores")!;
      colors.getCell("E1").value = "usar_cor_secundaria";
      colors.getRow(2).values = ["Araras", "#112233", "#FFFFFF", "", "NAO"];
      colors.addRow(["Preto + Branco", "#000000", "#FFFFFF", "", "SIM"]);
      colors.addRow(["Mesmo HEX", "#000000", "#000000", "", "SIM"]);
      const variations = workbook.getWorksheet("Variacoes")!;
      variations.getCell("C2").value = "Araras";
      variations.addRow(["PROD-1", "VAR-2", "Preto + Branco", "36", "SKU-2", true, 1]);
      variations.addRow(["PROD-1", "VAR-3", "Mesmo HEX", "37", "SKU-3", true, 1]);
    });
    const product = (await parseProductImportWorkbook(bytes)).products[0]!;
    expect(product.categories).toEqual([{ name: "Chinelos", primary: true }, { name: "Feminino", primary: false }]);
    expect(product.variants.map((variant) => variant.colorHexSecondary)).toEqual(["", "#FFFFFF", ""]);
  });

  it("rejects an invalid workbook and an incorrect schema version", async () => {
    await expect(parseProductImportWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(parseProductImportWorkbook(await minimalWorkbook("wrong_schema"))).rejects.toThrow(/schema_version/iu);
  });

  it("accepts only the documented boolean Config values and ignores unknown flags", async () => {
    const batch = await parseProductImportWorkbook(await minimalWorkbook(PRODUCT_IMPORT_SCHEMA, false, [
      ["criar_categoria_se_ausente", "não"],
      ["criar_modelo_se_ausente", "false"],
      ["associar_imagem_cor_a_todos_tamanhos", "1"],
      ["deduplicar_download_imagem_por_url", "0"],
      ["opcao_desconhecida", "SIM"]
    ]));
    expect(batch.options).toEqual({
      createCategoryIfMissing: false,
      createModelIfMissing: false,
      associateColorImagesToAllSizes: true,
      deduplicateImageDownloadsByUrl: false
    });
    await expect(parseProductImportWorkbook(await minimalWorkbook(PRODUCT_IMPORT_SCHEMA, false, [
      ["criar_categoria_se_ausente", "talvez"]
    ]))).rejects.toThrow(/criar_categoria_se_ausente/iu);
  });

  it("allows only the Shopee CDN present in the contract", () => {
    expect(isAllowedShopeeImageUrl("https://down-sg.img.susercontent.com/file/example")).toBe(true);
    expect(isAllowedShopeeImageUrl("http://down-sg.img.susercontent.com/file/example")).toBe(false);
    expect(isAllowedShopeeImageUrl("https://example.com/image.jpg")).toBe(false);
    expect(isAllowedShopeeImageUrl("https://down-sg.img.susercontent.com.evil.test/image.jpg")).toBe(false);
  });

  it("deduplicates normalized image URLs and safely merges their metadata", () => {
    const first = "https://down-sg.img.susercontent.com/file/example?b=2&a=1#ignored";
    const second = "https://down-sg.img.susercontent.com/file/example?a=1&b=2";
    const prepared = prepareProductImportImages([
      { url: first, color: "Lilás", order: 4, primary: false, applyAllSizes: true },
      { url: second, color: "Rosa", order: 1, primary: true, applyAllSizes: true }
    ]);

    expect(normalizeProductImportImageUrl(first)).toBe(second);
    expect(prepared.images).toHaveLength(1);
    expect(prepared.images[0]).toMatchObject({ color: "", order: 1, primary: true, applyAllSizes: false });
    expect(prepared.warnings).toHaveLength(1);
  });

  it("accepts only bounded normalized payloads in an import session", async () => {
    const batch = await parseProductImportWorkbook(await minimalWorkbook());
    const payload = {
      batch,
      references: { "PROD-1": { categoryId: "20000000-0000-0000-0000-000000000001", modelId: null, collectionId: null } }
    };
    expect(parseProductImportSessionPayload(payload).batch.products[0]?.key).toBe("PROD-1");
    expect(() => parseProductImportSessionPayload({ ...payload, references: {} })).toThrow(/sessão/iu);
  });

  it("stops the queue after a network failure", async () => {
    const called: string[] = [];
    const results = await runProductImportQueue(["one", "two", "three"], async (key) => {
      called.push(key);
      if (key === "two") throw new Error("failed");
      return { productKey: key, ok: true, message: "ok" };
    });
    expect(called).toEqual(["one", "two"]);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(results[1]?.queueStopped).toBe(true);
  });

  it("stops the queue after a global server failure", async () => {
    const called: string[] = [];
    const progress: number[] = [];
    const results = await runProductImportQueue(["one", "two", "three"], async (key) => {
      called.push(key);
      return {
        productKey: key,
        ok: false,
        retryable: true,
        code: "IMPORT_TEMPORARILY_UNAVAILABLE",
        message: "Serviço indisponível"
      };
    }, (_results, percentage) => progress.push(percentage));

    expect(called).toEqual(["one"]);
    expect(results).toEqual([expect.objectContaining({ queueStopped: true })]);
    expect(progress).toEqual([100]);
  });

  it("continues image batches and keeps the state from the first product request", async () => {
    const offsets: number[] = [];
    const result = await runProductImportBatches("PROD-1", async (imageOffset) => {
      offsets.push(imageOffset);
      if (imageOffset < 4) return {
        productKey: "PROD-1", ok: true, alreadyImported: imageOffset > 0,
        warnings: ["Aviso repetido"], message: "continuando", hasMore: true,
        nextImageOffset: imageOffset < 0 ? 0 : imageOffset + 2
      };
      return {
        productKey: "PROD-1", ok: true, alreadyImported: true,
        warnings: ["Aviso repetido"], message: "concluído", hasMore: false
      };
    }, 0);

    expect(offsets).toEqual([-1, 0, 2, 4]);
    expect(result).toMatchObject({ ok: true, alreadyImported: false, warnings: ["Aviso repetido"] });
  });

  it("does not retry a transient server failure in the browser", async () => {
    let attempts = 0;
    const result = await runProductImportBatches("PROD-1", async () => {
      attempts += 1;
      return { productKey: "PROD-1", ok: false, retryable: true, message: "HTTP 503" };
    }, 0);

    expect(attempts).toBe(1);
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("does not retry a deterministic server failure", async () => {
    let attempts = 0;
    const result = await runProductImportBatches("PROD-1", async () => {
      attempts += 1;
      return { productKey: "PROD-1", ok: false, retryable: false, code: "INVALID_PRODUCT_DATA", message: "Dados inválidos" };
    }, 0);

    expect(attempts).toBe(1);
    expect(result).toMatchObject({ ok: false, code: "INVALID_PRODUCT_DATA" });
  });
});
