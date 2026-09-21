import { describe, expect, it } from "vitest";
import {
  buildNewProductDraft,
  isProductDraftStoredLocally,
  newProductDraftSchema,
  productDraftSyncFailureAction,
  storeProductDraftLocally
} from "../lib/product-draft";
import {
  automaticProductSeo,
  filterManagedProducts,
  generateVariantCombinations,
  groupEditableVariantsByColor,
  isManagedProduct,
  partitionProductMediaFiles,
  parseNewProductDraft,
  productDraftStorageKey,
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
  it("monta o snapshot real do editor e ignora controles não persistíveis", () => {
    const draft = buildNewProductDraft({
      savedAt: "2026-09-20T12:00:00.000Z",
      fields: {
        name: "Slide teste",
        slug: "slide-teste",
        description: "Descrição do produto",
        modelId: "",
        collectionId: "",
        statusReason: "",
        price: "59.90",
        compareAtPrice: "",
        cost: "",
        stockReason: "Estoque definido no cadastro do produto",
        weightGrams: "",
        heightCm: "",
        widthCm: "",
        lengthCm: "40",
        shortDescription: "",
        productKind: "variations",
        futureEditorControl: "ignorar"
      },
      categoryIds: ["20000000-0000-4000-8000-000000000001"],
      primaryCategoryId: "20000000-0000-4000-8000-000000000001",
      variants: [
        { sku: "SLIDE-39", color: "Azul", colorHex: "#0000ff", colorHexSecondary: "", size: "39", priceInCents: null, costInCents: null, stock: 2, active: true, gtin: "", mpn: "" },
        { sku: "SLIDE-40", color: "Azul", colorHex: "#0000ff", colorHexSecondary: "", size: "40", priceInCents: null, costInCents: null, stock: 2, active: true, gtin: "", mpn: "" }
      ],
      hasVariations: true,
      simpleStock: 0,
      productActive: false,
      variantColors: "Azul",
      variantSizes: "39, 40",
      variantSkuPrefix: "SLIDE",
      sizeGuide: [
        { clientRowId: "row-39", size: "39", measurementCm: 27 },
        { clientRowId: "row-40", size: "40", measurementCm: 27 }
      ],
      specifications: [{ clientRowId: "spec-1", label: "Material", value: "Borracha" }]
    });

    expect(draft).not.toBeNull();
    expect(newProductDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft?.fields).toMatchObject({
      weightGrams: "", heightCm: "", widthCm: "", lengthCm: "40",
      stockReason: "Estoque definido no cadastro do produto"
    });
    expect(draft?.fields).not.toHaveProperty("productKind");
    expect(draft?.fields).not.toHaveProperty("futureEditorControl");
    expect(draft?.sizeGuide).toEqual([
      { size: "39", measurementCm: 27 },
      { size: "40", measurementCm: 27 }
    ]);
  });

  it("não repete payload rejeitado e reserva retry para rate limit ou indisponibilidade", () => {
    expect(productDraftSyncFailureAction(400)).toBe("drop");
    expect(productDraftSyncFailureAction(401)).toBe("drop");
    expect(productDraftSyncFailureAction(403)).toBe("drop");
    expect(productDraftSyncFailureAction(409)).toBe("drop");
    expect(productDraftSyncFailureAction(429)).toBe("wait");
    expect(productDraftSyncFailureAction(503)).toBe("retry");
  });

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

  it("separa e valida o rascunho local por usuário", () => {
    expect(productDraftStorageKey("user-a")).not.toBe(productDraftStorageKey("user-b"));
    expect(parseNewProductDraft(JSON.stringify({
      version: 1, savedAt: new Date().toISOString(), fields: { name: "Slide" }, categoryIds: [],
      primaryCategoryId: "", variants: [], hasVariations: false, simpleStock: 3,
      variantColors: "", variantSizes: "", variantSkuPrefix: ""
    }))).toMatchObject({ fields: { name: "Slide" }, simpleStock: 3 });
    expect(parseNewProductDraft("invalid")).toBeNull();
  });

  it("confirma a gravação local antes de permitir fechar o cadastro", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    const draft = buildNewProductDraft({
      savedAt: "2026-09-21T12:00:00.000Z",
      fields: { name: "Produto recuperável" },
      categoryIds: [], primaryCategoryId: "", variants: [], hasVariations: false,
      simpleStock: 0, productActive: false, variantColors: "", variantSizes: "",
      variantSkuPrefix: "", sizeGuide: [], specifications: []
    });
    expect(draft).not.toBeNull();
    expect(storeProductDraftLocally(storage, "draft", draft!)).toBe(true);
    expect(isProductDraftStoredLocally(storage, "draft", draft!)).toBe(true);
    expect(storeProductDraftLocally({
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); }
    }, "draft", draft!)).toBe(false);
  });

  it("recupera rascunho local com campos extras de uma versão anterior", () => {
    expect(parseNewProductDraft(JSON.stringify({
      schemaVersion: 1,
      savedAt: "2026-09-21T12:00:00.000Z",
      fields: { name: "Produto anterior", futureField: "ignorar" },
      categoryIds: [], primaryCategoryId: "", variants: [], hasVariations: false,
      simpleStock: 0, productActive: false, variantColors: "", variantSizes: "",
      variantSkuPrefix: "", sizeGuide: [], specifications: [], futureTopLevel: true
    }))).toMatchObject({ fields: { name: "Produto anterior" } });
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

  it("preserva as duas tonalidades ao agrupar tamanhos da mesma cor", () => {
    const variants = generateVariantCombinations("Preto e Branco", "35, 36", "Slide")
      .map((variant) => ({
        ...variant,
        colorHex: "#000000",
        colorHexSecondary: "#FFFFFF"
      }));
    expect(groupEditableVariantsByColor(variants)[0]).toMatchObject({
      color: "Preto e Branco",
      colorHex: "#000000",
      colorHexSecondary: "#FFFFFF"
    });
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
