import { describe, expect, it } from "vitest";
import {
  automaticProductSeo,
  filterManagedProducts,
  generateVariantCombinations,
  groupEditableVariantsByColor,
  isManagedProduct,
  partitionProductMediaFiles,
  productDeletionMessage,
  productPublicationMessage,
  productPublishRequirements,
  productThumbnail
} from "../lib/product-management";

const products = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Produto disponível",
    slug: "produto-disponivel",
    status: "active",
    priceInCents: 1000,
    stock: 1,
    variants: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        sku: "SKU-1",
        color: "Preto",
        size: "40",
        active: true,
        available: 1,
        reserved: 0,
        sellable: 1
      }
    ]
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    name: "Produto sem saldo",
    slug: "produto-sem-saldo",
    status: "active",
    priceInCents: 2000,
    stock: 0,
    variants: []
  }
];

describe("product management", () => {
  it("mantém produtos sem estoque visíveis no filtro interno", () => {
    expect(filterManagedProducts(products, "out", "")).toEqual([products[1]]);
  });

  it("busca por nome ou SKU sem alterar a lista original", () => {
    expect(filterManagedProducts(products, "all", "sku-1")).toEqual([products[0]]);
    expect(products).toHaveLength(2);
  });

  it("gera combinações de cor e tamanho com SKU estável", () => {
    const variants = generateVariantCombinations("Azul, Preto", "35, 36", "Sandália 10");
    expect(variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: "SANDALIA-10-AZUL-35", color: "Azul", size: "35" }),
        expect.objectContaining({ sku: "SANDALIA-10-PRETO-36", color: "Preto", size: "36" })
      ])
    );
    expect(variants).toHaveLength(4);
  });

  it("gera as 36 combinações do kit sem interpretar nomes compostos como hexadecimal", () => {
    const variants = generateVariantCombinations(
      "Preto+Preto, Branco+Branco, Preto+Bege, Bege+Branco, Lilás+Branco, Lilás+Preto",
      "34, 35, 36, 37, 38, 39",
      "KIT"
    );
    expect(variants).toHaveLength(36);
    expect(variants).toContainEqual(
      expect.objectContaining({ color: "Lilás+Branco", size: "39", colorHex: "" })
    );
  });

  it("separa os requisitos de publicação dos requisitos de rascunho", () => {
    expect(productPublishRequirements({ name: "Rascunho", variants: [] })).toEqual([
      "categoria",
      "preço de venda",
      "estoque do produto"
    ]);
  });

  it("valida a publicação com mensagens específicas sem exigir SEO ou dimensões", () => {
    expect(productPublicationMessage({ name: "Sandália X", categoryIds: [], priceInCents: 8990, variants: [{ active: true }] }))
      .toBe("Escolha a categoria do produto.");
    expect(productPublicationMessage({ name: "Sandália X", categoryIds: ["feminino"], priceInCents: 0, variants: [{ active: true }] }))
      .toBe("Adicione o preço do produto.");
    expect(productPublicationMessage({ name: "Sandália X", categoryIds: ["feminino"], priceInCents: 8990, variants: [{ active: true }] }))
      .toBeNull();
  });

  it("gera SEO automático sem campos manuais", () => {
    expect(automaticProductSeo({ name: "Sandália X", categoryName: "Feminino" })).toEqual({
      title: "Sandália X | Feminino | curtiZ",
      description: "Sandália X na categoria Feminino. Compre online na curtiZ."
    });
  });

  it("explica bloqueios sem confundir falha de consulta com histórico comercial", () => {
    expect(productDeletionMessage(["cart items", "pedidos"])).toContain("itens em carrinhos, pedidos. Use Arquivar");
    expect(productDeletionMessage()).toContain("Não foi possível confirmar");
  });

  it("usa imagem principal, depois a primeira imagem e só então nenhum resultado", () => {
    const first = { id: "1", path: "first.webp", url: "/first.webp", alt: "Primeira", primary: false, sortOrder: 0, width: 100, height: 100 };
    const primary = { ...first, id: "2", path: "main.webp", url: "/main.webp", primary: true, sortOrder: 1 };
    expect(productThumbnail({ images: [first, primary] })).toBe(primary);
    expect(productThumbnail({ images: [first] })).toBe(first);
    expect(productThumbnail({ images: [] })).toBeNull();
  });

  it("agrupa somente as combinações reais por cor e preserva tamanhos desiguais", () => {
    const variants = [
      ...generateVariantCombinations("Azul", "35, 36", "Slide"),
      ...generateVariantCombinations("Preto", "39", "Slide")
    ];
    const groups = groupEditableVariantsByColor(variants);

    expect(
      groups.map((group) => [group.color, group.variants.map(({ variant }) => variant.size)])
    ).toEqual([
      ["Azul", ["35", "36"]],
      ["Preto", ["39"]]
    ]);
  });

  it("rejeita produto incompleto antes de abrir o editor", () => {
    expect(isManagedProduct(products[0])).toBe(true);
    expect(isManagedProduct({ ...products[0], id: "produto-invalido" })).toBe(false);
    expect(isManagedProduct({ ...products[0], variants: null })).toBe(false);
    expect(isManagedProduct({ ...products[0], stock: Number.NaN })).toBe(false);
    expect(
      isManagedProduct({
        ...products[0],
        variants: [{ ...products[0]!.variants[0]!, available: undefined }]
      })
    ).toBe(false);
    expect(
      isManagedProduct({
        ...products[0],
        images: [
          {
            id: crypto.randomUUID(),
            path: "invalida.webp",
            url: "",
            alt: "",
            primary: true,
            sortOrder: 0
          }
        ]
      })
    ).toBe(false);
  });

  it("aceita imagens até 10 MB e vídeos MP4/WebM até 80 MB", () => {
    const valid = { name: "produto.webp", type: "image/webp", size: 2_000_000 };
    const video = { name: "produto.mp4", type: "video/mp4", size: 40_000_000 };
    const tooLarge = { name: "grande.png", type: "image/png", size: 10 * 1024 * 1024 + 1 };
    const renamed = { name: "produto.jpg", type: "video/mp4", size: 2_000 };
    const invalidType = { name: "produto.svg", type: "image/svg+xml", size: 2_000 };

    expect(partitionProductMediaFiles([valid, video, tooLarge, renamed, invalidType])).toEqual({
      accepted: [valid, video],
      rejected: [tooLarge, renamed, invalidType]
    });
  });
});
