import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";

vi.mock("server-only", () => ({}));

import {
  PRODUCT_IMPORT_SCHEMA,
  generatedImportSku,
  isAllowedShopeeImageUrl,
  parseProductImportWorkbook,
  productImportPreview
} from "./product-import";
import { runProductImportBatches, runProductImportQueue } from "./product-import-client";

const fixture = readFileSync("../../docs/import/curtiz_importacao_produtos_shopee.xlsx");

async function minimalWorkbook(schemaVersion = PRODUCT_IMPORT_SCHEMA, withOptionalData = false) {
  const workbook = new Workbook();
  workbook.addWorksheet("Config").addRows([["chave", "valor"], ["schema_version", schemaVersion]]);
  workbook.addWorksheet("Produtos").addRows([
    ["schema_version", "produto_chave", "shopee_id", "nome", "slug", "categoria", "preco_base", "descricao", "descricao_curta", "custo", "peso_g", "altura_cm", "largura_cm", "comprimento_cm"],
    [schemaVersion, "PROD-1", "1", "Produto mínimo", "produto-minimo", "Chinelos", 10, "", "", "", "", "", "", ""]
  ]);
  workbook.addWorksheet("Cores").addRows([
    ["cor_nome", "hex_principal", "hex_secundario", "hex_terciario"],
    ["Lilás", "#C8A2C8", "", ""]
  ]);
  workbook.addWorksheet("Variacoes").addRows([
    ["produto_chave", "variacao_chave", "cor_nome", "tamanho", "sku", "ativo", "estoque", "preco_override", "custo_override", "gtin", "mpn"],
    ["PROD-1", "VAR-1", "Lilás", "35", "", true, "", "", "", "", ""]
  ]);
  workbook.addWorksheet("Imagens").addRow(["produto_chave", "url", "ordem", "principal", "cor_nome", "aplicar_todos_tamanhos"]);
  if (withOptionalData) {
    workbook.addWorksheet("Tabela_Tamanhos").addRows([
      ["produto_chave", "tamanho", "medida_cm"],
      ["PROD-1", "35", 23.5]
    ]);
    workbook.addWorksheet("Especificacoes").addRows([
      ["produto_chave", "campo", "valor"],
      ["PROD-1", "Material", "Borracha"]
    ]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("product XLSX import", () => {
  it("reads the official curtiz_import_v1 fixture", async () => {
    const batch = await parseProductImportWorkbook(fixture);
    expect(batch.schemaVersion).toBe(PRODUCT_IMPORT_SCHEMA);
    expect(batch.products).toHaveLength(12);
    expect(batch.products.reduce((total, product) => total + product.variants.length, 0)).toBe(408);
    expect(batch.products.reduce((total, product) => total + product.images.length, 0)).toBe(176);
    expect(productImportPreview(batch).summary.images).toBe(176);
    expect(batch.colorCount).toBe(30);
  });

  it("keeps optional empty fields nullable, empty stock at zero, colors and stable generated SKU", async () => {
    const batch = await parseProductImportWorkbook(await minimalWorkbook());
    const product = batch.products[0]!;
    expect(product).toMatchObject({ description: "", shortDescription: "", costInCents: null, weightGrams: null, sizeGuide: [], specifications: [] });
    expect(product.variants[0]).toMatchObject({ stock: 0, color: "Lilás", colorHex: "#C8A2C8", colorHexSecondary: "" });
    expect(product.variants[0]?.sku).toBe(generatedImportSku("PROD-1", "Lilás", "35"));
  });

  it("preserves color image associations and ignores instructional rows in optional sheets", async () => {
    const batch = await parseProductImportWorkbook(fixture);
    expect(batch.products.flatMap((product) => product.images).some((image) => image.color && image.applyAllSizes)).toBe(true);
    expect(batch.products.reduce((total, product) => total + product.sizeGuide.length, 0)).toBe(0);
    expect(batch.products.reduce((total, product) => total + product.specifications.length, 0)).toBe(0);
  });

  it("reads valid size guide and specification rows from optional sheets", async () => {
    const product = (await parseProductImportWorkbook(await minimalWorkbook(PRODUCT_IMPORT_SCHEMA, true))).products[0]!;
    expect(product.sizeGuide).toEqual([{ size: "35", measurementCm: 23.5 }]);
    expect(product.specifications).toEqual([{ label: "Material", value: "Borracha" }]);
  });

  it("rejects an invalid workbook and an incorrect schema version", async () => {
    await expect(parseProductImportWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(parseProductImportWorkbook(await minimalWorkbook("wrong_schema"))).rejects.toThrow(/schema_version/iu);
  });

  it("allows only the Shopee CDN present in the contract", () => {
    expect(isAllowedShopeeImageUrl("https://down-sg.img.susercontent.com/file/example")).toBe(true);
    expect(isAllowedShopeeImageUrl("http://down-sg.img.susercontent.com/file/example")).toBe(false);
    expect(isAllowedShopeeImageUrl("https://example.com/image.jpg")).toBe(false);
    expect(isAllowedShopeeImageUrl("https://down-sg.img.susercontent.com.evil.test/image.jpg")).toBe(false);
  });

  it("continues the queue after one product fails", async () => {
    const called: string[] = [];
    const results = await runProductImportQueue(["one", "two", "three"], async (key) => {
      called.push(key);
      if (key === "two") throw new Error("failed");
      return { productKey: key, ok: true, message: "ok" };
    });
    expect(called).toEqual(["one", "two", "three"]);
    expect(results.map((result) => result.ok)).toEqual([true, false, true]);
  });

  it("continues image batches and keeps the state from the first product request", async () => {
    const offsets: number[] = [];
    const result = await runProductImportBatches("PROD-1", async (imageOffset) => {
      offsets.push(imageOffset);
      if (imageOffset < 4) return {
        productKey: "PROD-1", ok: true, alreadyImported: imageOffset > 0,
        warnings: ["Aviso repetido"], message: "continuando", hasMore: true,
        nextImageOffset: imageOffset + 2
      };
      return {
        productKey: "PROD-1", ok: true, alreadyImported: true,
        warnings: ["Aviso repetido"], message: "concluído", hasMore: false
      };
    }, 0);

    expect(offsets).toEqual([0, 2, 4]);
    expect(result).toMatchObject({ ok: true, alreadyImported: false, warnings: ["Aviso repetido"] });
  });

  it("retries a transient worker failure without duplicating the product", async () => {
    let attempts = 0;
    const result = await runProductImportBatches("PROD-1", async () => {
      attempts += 1;
      if (attempts < 3) return { productKey: "PROD-1", ok: false, retryable: true, message: "HTTP 503" };
      return { productKey: "PROD-1", ok: true, alreadyImported: true, message: "concluído", hasMore: false };
    }, 0, 0);

    expect(attempts).toBe(3);
    expect(result).toMatchObject({ ok: true, alreadyImported: true });
  });
});
