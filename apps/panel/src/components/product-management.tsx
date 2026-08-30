"use client";

import {
  Archive,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelDrawer } from "@/components/panel-drawer";
import {
  type EditableVariant,
  generateVariantCombinations,
  groupEditableVariantsByColor,
  isManagedProduct,
  partitionProductMediaFiles,
  type ManagedProduct
} from "@/lib/product-management";

type CatalogResponse = {
  products?: ManagedProduct[];
  categories?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string }>;
  collections?: Array<{ id: string; name: string }>;
  total?: number;
  pageSize?: number;
  message?: string;
  productId?: string;
  capabilities?: {
    create?: boolean;
    update?: boolean;
    adjustStock?: boolean;
    archive?: boolean;
    delete?: boolean;
  };
  capabilityMessage?: string;
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

const productSlug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

const productStatusLabel = (status: string) =>
  ({
    draft: "Rascunho",
    pending_review: "Em análise",
    active: "Publicado",
    inactive: "Inativo",
    out_of_stock: "Sem estoque",
    archived: "Arquivado",
    rejected: "Rejeitado"
  })[status] ?? status;

type ProductManagementView = "produtos" | "variacoes" | "midias" | "estoque";

type ProductEditorSection =
  "information" | "commercial" | "images" | "variants" | "logistics" | "content";

const productEditorSections: Array<{
  id: ProductEditorSection;
  label: string;
  target: string;
}> = [
  { id: "information", label: "Informações", target: "product-step-1" },
  { id: "commercial", label: "Preços", target: "product-step-3" },
  { id: "images", label: "Imagens", target: "product-step-4" },
  { id: "variants", label: "Variações", target: "product-step-5" },
  { id: "logistics", label: "Logística", target: "product-step-7" },
  { id: "content", label: "Conteúdo e SEO", target: "product-step-8" }
];

function QueuedProductImage({
  file,
  index,
  onRemove
}: {
  file: File;
  index: number;
  onRemove: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <article className="product-media-queued-item">
      {previewUrl ? (
        <Image
          src={previewUrl}
          alt={`Prévia da imagem ${index + 1}`}
          width={160}
          height={160}
          unoptimized
        />
      ) : null}
      <div>
        <strong>{file.name}</strong>
        <span>{index === 0 ? "Será a imagem principal" : "Pronta para envio"}</span>
        <button className="secondary-button" type="button" onClick={onRemove}>
          <Trash2 /> Remover
        </button>
      </div>
    </article>
  );
}

const productViewCopy: Record<ProductManagementView, { title: string; detail: string }> = {
  produtos: { title: "Produtos", detail: "Estoque, variações e fotos" },
  variacoes: { title: "Variações", detail: "Variações do produto" },
  midias: { title: "Mídias", detail: "Fotos do produto" },
  estoque: { title: "Estoque", detail: "Saldo e reposição por variação" }
};

export function ProductManagement({
  view = "produtos",
  initialQuery = ""
}: {
  view?: ProductManagementView;
  initialQuery?: string;
}) {
  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [filter, setFilter] = useState<"all" | "out">("all");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [capabilityNotice, setCapabilityNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [openingProductId, setOpeningProductId] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ManagedProduct | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedProduct | null>(null);
  const [editing, setEditing] = useState<ManagedProduct | "new" | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<ManagedProduct | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    product: ManagedProduct;
    nextStatus: string;
  } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [capabilities, setCapabilities] = useState({
    create: false,
    update: false,
    adjustStock: false,
    archive: false,
    delete: false
  });
  const [editableVariants, setEditableVariants] = useState<EditableVariant[]>([]);
  const [variantColors, setVariantColors] = useState("");
  const [variantSizes, setVariantSizes] = useState("");
  const [variantSkuPrefix, setVariantSkuPrefix] = useState("");
  const [newVariantSizes, setNewVariantSizes] = useState<Record<string, string>>({});
  const [colorImageSelections, setColorImageSelections] = useState<Record<string, string>>({});
  const [mediaAltTexts, setMediaAltTexts] = useState<Record<string, string>>({});
  const [mediaDeleteTarget, setMediaDeleteTarget] = useState<{ id: string; alt: string } | null>(
    null
  );
  const [draggedMediaId, setDraggedMediaId] = useState("");
  const [queuedMediaFiles, setQueuedMediaFiles] = useState<File[]>([]);
  const [activeEditorSection, setActiveEditorSection] =
    useState<ProductEditorSection>("information");
  const pendingActionRef = useRef(false);
  const quantities = useRef<Record<string, HTMLInputElement | null>>({});
  const reasons = useRef<Record<string, HTMLInputElement | null>>({});
  const editorFormRef = useRef<HTMLFormElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (submittedQuery) params.set("q", submittedQuery);
      if (status) params.set("status", status);
      if (filter === "out") params.set("stock", "out");
      const response = await fetch(`/api/catalog/products?${params}`, { cache: "no-store" });
      const result = (await response.json()) as CatalogResponse;
      setCapabilities({
        create: result.capabilities?.create === true,
        update: result.capabilities?.update === true,
        adjustStock: result.capabilities?.adjustStock === true,
        archive: result.capabilities?.archive === true,
        delete: result.capabilities?.delete === true
      });
      setCapabilityNotice(result.capabilityMessage ?? "");
      if (!response.ok) throw new Error(result.message);
      if (!Array.isArray(result.products) || !result.products.every(isManagedProduct)) {
        throw new Error("O catálogo retornou dados de produto inválidos.");
      }
      setProducts(result.products);
      setCategories(result.categories ?? []);
      setModels(result.models ?? []);
      setCollections(result.collections ?? []);
      setTotal(result.total ?? 0);
      setPageSize(result.pageSize ?? 20);
    } catch (error) {
      setProducts([]);
      setTotal(0);
      setCapabilities({
        create: false,
        update: false,
        adjustStock: false,
        archive: false,
        delete: false
      });
      setCapabilityNotice("");
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível carregar os produtos agora."
      );
    } finally {
      setLoading(false);
    }
  }, [filter, page, status, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hasDialog = Boolean(
      archiveTarget || deleteTarget || duplicateTarget || mediaDeleteTarget || statusTarget
    );
    if (!hasDialog) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || pending) return;
      setArchiveTarget(null);
      setDeleteTarget(null);
      setDuplicateTarget(null);
      setMediaDeleteTarget(null);
      setStatusTarget(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [archiveTarget, deleteTarget, duplicateTarget, mediaDeleteTarget, pending, statusTarget]);

  const editingKey = editing === "new" ? "new" : (editing?.id ?? "");

  useEffect(() => {
    if (!editing || !editingKey) return;
    if (editing === "new") {
      setEditableVariants([]);
      setVariantColors("");
      setVariantSizes("");
      setVariantSkuPrefix("");
      setNewVariantSizes({});
      setColorImageSelections({});
      setQueuedMediaFiles([]);
      setActiveEditorSection("information");
      setEditorDirty(false);
      return;
    }
    setEditableVariants(
      editing.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        color: variant.color,
        colorHex: variant.colorHex ?? "",
        size: variant.size,
        priceInCents: variant.priceInCents ?? null,
        costInCents: variant.costInCents ?? null,
        stock: variant.available,
        active: variant.active
      }))
    );
    setColorImageSelections({});
    setVariantSkuPrefix(editing.slug);
    setVariantColors("");
    setVariantSizes("");
    setNewVariantSizes({});
    setMediaAltTexts(
      Object.fromEntries((editing.images ?? []).map((image) => [image.id, image.alt]))
    );
    setEditorDirty(false);
  }, [editingKey]);

  const closeEditor = useCallback(() => {
    setEditing(null);
    setEditorDirty(false);
    setNewVariantSizes({});
    setQueuedMediaFiles([]);
    setActiveEditorSection("information");
  }, []);

  const openNewProduct = () => {
    setQueuedMediaFiles([]);
    setActiveEditorSection("information");
    setEditing("new");
  };

  useEffect(() => {
    if (!editingKey) return;
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase("pt-BR") !== "s") return;
      event.preventDefault();
      if (pendingActionRef.current) return;
      const form = editorFormRef.current;
      if (!form) return;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      form.requestSubmit();
    };
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [editingKey]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const viewCopy = productViewCopy[view];
  const canCreateProduct = view === "produtos" && capabilities.create;
  const canUpdateProduct = capabilities.update;
  const canAdjustStock = capabilities.adjustStock;
  const groupedEditableVariants = useMemo(
    () => groupEditableVariantsByColor(editableVariants),
    [editableVariants]
  );
  const editorImages = editing === "new" || !editing ? [] : (editing.images ?? []);

  const readProduct = async (productId: string) => {
    const params = new URLSearchParams({ productId });
    const response = await fetch(`/api/catalog/products?${params}`, { cache: "no-store" });
    const result = (await response.json()) as CatalogResponse;
    const selected = result.products?.[0];
    if (!response.ok || !isManagedProduct(selected)) {
      throw new Error(result.message ?? "Produto não encontrado.");
    }
    return selected;
  };

  const refreshEditingProduct = async (productId: string) => {
    const selected = await readProduct(productId);
    setMediaAltTexts(
      Object.fromEntries((selected.images ?? []).map((image) => [image.id, image.alt]))
    );
    setEditing((current) => (current !== "new" && current?.id === productId ? selected : current));
  };

  const openProduct = async (product: ManagedProduct) => {
    if (openingProductId || pending) return;
    setOpeningProductId(product.id);
    setMessage("");
    setQueuedMediaFiles([]);
    setActiveEditorSection("information");
    try {
      setEditing(await readProduct(product.id));
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível abrir o produto agora."
      );
    } finally {
      setOpeningProductId("");
    }
  };

  const execute = async (body: Record<string, unknown>, key: string) => {
    if (pendingActionRef.current) return null;
    pendingActionRef.current = true;
    setPending(key);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/products", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as CatalogResponse;
      setMessage(result.message ?? (response.ok ? "Alteração concluída." : "A alteração falhou."));
      if (response.ok) {
        await load();
        return result;
      }
      return null;
    } catch {
      setMessage("Não foi possível concluir a alteração agora.");
      return null;
    } finally {
      pendingActionRef.current = false;
      setPending("");
    }
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const wasNew = editing === "new";
    const hadQueuedMedia = queuedMediaFiles.length > 0;
    const form = new FormData(event.currentTarget);
    const result = await execute(
      {
        action: "save",
        ...(wasNew ? {} : { productId: editing.id }),
        name: form.get("name"),
        slug: form.get("slug"),
        shortDescription: form.get("shortDescription"),
        description: form.get("description"),
        categoryId: form.get("categoryId"),
        modelId: form.get("modelId") || null,
        collectionId: form.get("collectionId") || null,
        status: form.get("status"),
        statusReason: form.get("statusReason") || undefined,
        featured: form.get("featured") === "on",
        priceInCents: Math.round(Number(form.get("price")) * 100),
        compareAtPriceInCents: form.get("compareAtPrice")
          ? Math.round(Number(form.get("compareAtPrice")) * 100)
          : null,
        costInCents: Math.round(Number(form.get("cost")) * 100),
        weightGrams: Number(form.get("weightGrams")),
        heightCm: Number(form.get("heightCm")),
        widthCm: Number(form.get("widthCm")),
        lengthCm: Number(form.get("lengthCm")),
        seoTitle: form.get("seoTitle"),
        seoDescription: form.get("seoDescription"),
        stockReason: form.get("stockReason"),
        variants: editableVariants
      },
      wasNew ? "new-product" : editing.id
    );
    if (!result) return;

    const productId = result.productId ?? (wasNew ? "" : editing.id);
    if (!productId) return;
    pendingActionRef.current = true;
    setPending(`save-${productId}`);
    try {
      let savedProduct = await readProduct(productId);
      setEditing(savedProduct);
      setEditorDirty(false);

      if (queuedMediaFiles.length) {
        await sendMediaFiles(savedProduct, queuedMediaFiles, (uploadedFile) => {
          setQueuedMediaFiles((current) => current.filter((file) => file !== uploadedFile));
        });
        savedProduct = await readProduct(productId);
        await load();
      }
      for (const [groupKey, imageId] of Object.entries(colorImageSelections)) {
        const variant = savedProduct.variants.find(
          (item) => item.color.trim().toLocaleLowerCase("pt-BR") === groupKey
        );
        if (!variant) continue;
        const response = await fetch("/api/catalog/products/media", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "associate",
            variantId: variant.id,
            imageId: imageId || null
          })
        });
        const association = (await response.json()) as CatalogResponse;
        if (!response.ok)
          throw new Error(association.message ?? "Falha ao associar a imagem à cor.");
      }
      if (Object.keys(colorImageSelections).length) savedProduct = await readProduct(productId);
      setEditing(savedProduct);
      setQueuedMediaFiles([]);
      setColorImageSelections({});
      setEditorDirty(false);
      setMessage(
        wasNew
          ? queuedMediaFiles.length
            ? "Produto criado e imagens enviadas. Continue com as cores e tamanhos quando necessário."
            : "Produto criado como rascunho."
          : "Produto atualizado."
      );
    } catch (error) {
      try {
        setEditing(await readProduct(productId));
        await load();
      } catch {
        // Preserve the original save/upload error below.
      }
      setEditorDirty(hadQueuedMedia);
      setMessage(
        error instanceof Error
          ? hadQueuedMedia
            ? `O produto foi salvo, mas as imagens não foram concluídas: ${error.message}`
            : `O produto foi salvo, mas uma configuração complementar falhou: ${error.message}`
          : "Produto salvo, mas a galeria não pôde ser atualizada."
      );
    } finally {
      pendingActionRef.current = false;
      setPending("");
    }
  };

  const changeStatus = async (
    product: ManagedProduct,
    nextStatus: string,
    providedReason?: string
  ) => {
    if (nextStatus === "active" && !product.variants.some((variant) => variant.active)) {
      setMessage(
        `Não é possível publicar "${product.name}". Cadastre e ative pelo menos uma variação antes de publicar.`
      );
      return;
    }

    const needsReason = ["inactive", "archived", "rejected"].includes(nextStatus);

    const reason = providedReason?.trim();
    if (needsReason && !reason) {
      setStatusReason("");
      setStatusTarget({ product, nextStatus });
      return;
    }

    const success = await execute(
      {
        action: "status",
        productId: product.id,
        status: nextStatus,
        reason
      },
      product.id
    );
    if (success) {
      setStatusTarget(null);
      setStatusReason("");
    }
  };

  const duplicateProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!duplicateTarget) return;
    const form = new FormData(event.currentTarget);
    const success = await execute(
      {
        action: "duplicate",
        productId: duplicateTarget.id,
        name: form.get("name"),
        slug: form.get("slug")
      },
      `duplicate-${duplicateTarget.id}`
    );
    if (success) setDuplicateTarget(null);
  };

  const updateEditableVariant = (index: number, value: Partial<EditableVariant>) => {
    setEditorDirty(true);
    setEditableVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, ...value } : variant
      )
    );
  };

  const generateVariants = () => {
    const generated = generateVariantCombinations(variantColors, variantSizes, variantSkuPrefix);
    if (!generated.length) {
      setMessage("Informe um prefixo de SKU, pelo menos uma cor e um tamanho.");
      return;
    }
    setEditableVariants((current) => {
      const byCombination = new Map(
        current.map((variant) => [
          `${variant.color.toLocaleLowerCase("pt-BR")}::${variant.size.toLocaleLowerCase("pt-BR")}`,
          variant
        ])
      );
      const additions = generated.filter(
        (variant) =>
          !byCombination.has(
            `${variant.color.toLocaleLowerCase("pt-BR")}::${variant.size.toLocaleLowerCase("pt-BR")}`
          )
      );
      return [...current, ...additions];
    });
    setEditorDirty(true);
    setMessage("Combinações novas adicionadas. As variações já cadastradas foram preservadas.");
  };

  const addSizeToColor = (groupKey: string, color: string, colorHex: string) => {
    const size = newVariantSizes[groupKey]?.trim() ?? "";
    const generated = generateVariantCombinations(color, size, variantSkuPrefix);
    if (!generated.length) {
      setMessage("Informe o tamanho e um prefixo de SKU para adicionar a variação.");
      return;
    }
    const duplicate = editableVariants.some(
      (variant) =>
        variant.color.trim().toLocaleLowerCase("pt-BR") ===
          color.trim().toLocaleLowerCase("pt-BR") &&
        variant.size.trim().toLocaleLowerCase("pt-BR") === size.toLocaleLowerCase("pt-BR")
    );
    if (duplicate) {
      setMessage(`O tamanho ${size} já existe para a cor ${color}.`);
      return;
    }
    const candidate = generated[0];
    if (!candidate) return;
    setEditableVariants((current) => [...current, { ...candidate, colorHex }]);
    setNewVariantSizes((current) => ({ ...current, [groupKey]: "" }));
    setEditorDirty(true);
  };

  const duplicateVariant = (variant: EditableVariant) => {
    const usedSkus = new Set(editableVariants.map((item) => item.sku.toLocaleUpperCase("pt-BR")));
    let suffix = 2;
    let sku = `${variant.sku}-COPIA`;
    while (usedSkus.has(sku.toLocaleUpperCase("pt-BR"))) {
      sku = `${variant.sku}-COPIA-${suffix}`;
      suffix += 1;
    }
    setEditableVariants((current) => [
      ...current,
      {
        ...variant,
        id: undefined,
        sku,
        size: `${variant.size} cópia`,
        stock: 0
      }
    ]);
    setEditorDirty(true);
    setMessage("Variação duplicada. Revise tamanho, SKU, preço e estoque antes de salvar.");
  };

  const sendMediaFiles = async (
    product: ManagedProduct,
    files: readonly File[],
    onUploaded?: (file: File) => void
  ) => {
    let uploaded = 0;
    for (const [index, file] of files.entries()) {
      const form = new FormData();
      form.set("productId", product.id);
      form.set("file", file);
      form.set("alt", product.name);
      form.set("primary", String((product.images?.length ?? 0) === 0 && index === 0));
      const response = await fetch("/api/catalog/products/media", { method: "POST", body: form });
      const result = (await response.json()) as CatalogResponse;
      if (!response.ok) throw new Error(result.message ?? "Falha no upload.");
      uploaded += 1;
      onUploaded?.(file);
    }
    return uploaded;
  };

  const selectNewProductMedia = (files: readonly File[]) => {
    const { accepted, rejected } = partitionProductMediaFiles(files);
    if (accepted.length) {
      setQueuedMediaFiles((current) => {
        const existing = new Set(
          current.map((file) => `${file.name}:${file.size}:${file.lastModified}`)
        );
        const additions = accepted.filter((file) => {
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (existing.has(key)) return false;
          existing.add(key);
          return true;
        });
        return [...current, ...additions];
      });
      setEditorDirty(true);
    }
    setMessage(
      rejected.length
        ? `${rejected.length} arquivo(s) ignorado(s). Use JPG, PNG ou WebP de até 10 MB.`
        : `${accepted.length} imagem(ns) pronta(s) para envio.`
    );
  };

  const uploadMedia = async (product: ManagedProduct, files: readonly File[]) => {
    const { accepted, rejected } = partitionProductMediaFiles(files);
    if (!accepted.length || pending) {
      if (rejected.length) setMessage("Use imagens JPG, PNG ou WebP de até 10 MB.");
      return;
    }
    setPending(`media-${product.id}`);
    setMessage("");
    let uploaded = 0;
    try {
      await sendMediaFiles(product, accepted, () => {
        uploaded += 1;
      });
      setMessage(
        `${uploaded} imagem(ns) adicionada(s) ao produto.${rejected.length ? ` ${rejected.length} arquivo(s) ignorado(s).` : ""}`
      );
      await load();
      await refreshEditingProduct(product.id);
    } catch (error) {
      if (uploaded) {
        try {
          await load();
          await refreshEditingProduct(product.id);
        } catch {
          // Keep the upload failure as the actionable message.
        }
      }
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar as imagens.");
    } finally {
      setPending("");
    }
  };

  const deleteProduct = async () => {
    if (!deleteTarget || pendingActionRef.current) return;
    pendingActionRef.current = true;
    setPending(`delete-${deleteTarget.id}`);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/products", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: deleteTarget.id })
      });
      const result = (await response.json()) as CatalogResponse;
      setMessage(
        result.message ?? (response.ok ? "Produto excluído permanentemente." : "A exclusão falhou.")
      );
      if (response.ok) {
        setDeleteTarget(null);
        await load();
      }
    } catch {
      setMessage("Não foi possível excluir o produto agora.");
    } finally {
      pendingActionRef.current = false;
      setPending("");
    }
  };

  const deleteMedia = async (imageId: string) => {
    if (pending) return;
    setPending(`image-${imageId}`);
    try {
      const response = await fetch("/api/catalog/products/media", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageId })
      });
      const result = (await response.json()) as CatalogResponse;
      setMessage(result.message ?? (response.ok ? "Imagem removida." : "Falha ao remover imagem."));
      if (response.ok) {
        await load();
        if (editing !== "new" && editing?.id) await refreshEditingProduct(editing.id);
        setMediaDeleteTarget(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível remover a imagem.");
    } finally {
      setPending("");
    }
  };

  const updateMedia = async (body: Record<string, unknown>) => {
    if (pending) return;
    const imageId = typeof body.imageId === "string" ? body.imageId : "";
    setPending(`image-${imageId}`);
    try {
      const response = await fetch("/api/catalog/products/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as CatalogResponse;
      setMessage(
        result.message ?? (response.ok ? "Mídia atualizada." : "Falha ao atualizar mídia.")
      );
      if (response.ok) {
        await load();
        if (editing !== "new" && editing?.id) await refreshEditingProduct(editing.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a mídia.");
    } finally {
      setPending("");
    }
  };

  return (
    <section className="panel-card product-management">
      <div className="page-heading">
        <div>
          <h1>{viewCopy.title}</h1>
        </div>
        <div className="product-header-actions">
          {canCreateProduct ? (
            <button className="primary-button" type="button" onClick={openNewProduct}>
              <Plus /> Cadastrar produto
            </button>
          ) : null}
        </div>
      </div>

      {!loading && !loadError && view === "produtos" && !canCreateProduct ? (
        <p className="form-message product-capability-notice" role="status">
          {capabilityNotice ||
            "Seu acesso atual n\u00e3o possui permiss\u00e3o para cadastrar produtos."}
        </p>
      ) : null}

      <div className="product-list-toolbar">
        <form
          className="product-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedQuery(query.trim());
          }}
        >
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor="product-search-input">
            Buscar produtos
          </label>
          <input
            id="product-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nome, slug ou SKU"
          />
          <button className="secondary-button" type="submit">
            Buscar
          </button>
        </form>
        <label className="product-status-filter">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setFilter("all");
              setStatus(event.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="draft">Rascunhos</option>
            <option value="pending_review">Em análise</option>
            <option value="active">Publicados</option>
            <option value="inactive">Inativos</option>
            <option value="out_of_stock">Sem estoque</option>
            <option value="rejected">Rejeitados</option>
            <option value="archived">Arquivados</option>
          </select>
        </label>
        <div className="product-filter-tabs" role="group" aria-label="Filtrar disponibilidade">
          <button
            className={filter === "all" && !status ? "secondary-button active" : "secondary-button"}
            type="button"
            onClick={() => {
              setPage(1);
              setFilter("all");
              setStatus("");
            }}
          >
            Todos
          </button>
          <button
            className={
              filter === "all" && status === "active"
                ? "secondary-button active"
                : "secondary-button"
            }
            type="button"
            onClick={() => {
              setPage(1);
              setFilter("all");
              setStatus("active");
            }}
          >
            Publicados
          </button>
          <button
            className={
              filter === "all" && status === "draft"
                ? "secondary-button active"
                : "secondary-button"
            }
            type="button"
            onClick={() => {
              setPage(1);
              setFilter("all");
              setStatus("draft");
            }}
          >
            Rascunhos
          </button>
          <button
            className={filter === "out" ? "secondary-button active" : "secondary-button"}
            type="button"
            onClick={() => {
              setPage(1);
              setFilter("out");
              setStatus("");
            }}
          >
            Sem estoque
          </button>
        </div>
        {query || submittedQuery || status || filter !== "all" ? (
          <button
            className="secondary-button filter-clear-button"
            type="button"
            onClick={() => {
              setQuery("");
              setSubmittedQuery("");
              setStatus("");
              setFilter("all");
              setPage(1);
            }}
          >
            <X /> Limpar filtros
          </button>
        ) : null}
      </div>

      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <div className="operational-empty">
          <LoaderCircle className="spin" />
          <strong>Carregando produtos</strong>
        </div>
      ) : loadError ? (
        <div className="operational-empty" role="alert">
          <Boxes />
          <strong>Não foi possível carregar os produtos</strong>
          <span>{loadError}</span>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="operational-empty">
          <Boxes />
          <strong>Nenhum produto encontrado</strong>
          <span>
            {canCreateProduct
              ? "Cadastre um produto ou limpe os filtros para visualizar o catálogo."
              : "Ajuste os filtros ou cadastre primeiro o produto relacionado."}
          </span>
          {canCreateProduct ? (
            <button className="primary-button" type="button" onClick={openNewProduct}>
              <Plus /> Cadastrar produto
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="managed-product-columns" aria-hidden="true">
            <span>Imagem</span>
            <span>Produto</span>
            <span>Status</span>
            <span>Preço</span>
            <span>Estoque</span>
            <span>Ações</span>
          </div>
          <div className="managed-product-list">
            {products.map((product) => (
              <article className="managed-product" key={product.id}>
                <header>
                  <div className="managed-product-image">
                    {product.images?.[0]?.url ? (
                      <Image
                        className="managed-product-thumbnail"
                        src={product.images[0].url}
                        alt=""
                        width={72}
                        height={72}
                        unoptimized
                      />
                    ) : (
                      <span className="managed-product-thumbnail placeholder" aria-hidden="true">
                        <ImageIcon />
                      </span>
                    )}
                  </div>
                  <div className="managed-product-identity">
                    <div>
                      <h3>{product.name}</h3>
                      <span>
                        {product.variants[0]?.sku ?? "Sem SKU"} · {product.variants.length}{" "}
                        variação(ões)
                      </span>
                    </div>
                  </div>
                  <div className="managed-product-status">
                    <span className={`status product-status-${product.status}`}>
                      {productStatusLabel(product.status)}
                    </span>
                  </div>
                  <div className="managed-product-commercial">
                    <strong>{formatBRL(product.priceInCents)}</strong>
                  </div>
                  <div className="managed-product-stock">
                    <strong>{product.stock.toLocaleString("pt-BR")}</strong>
                    <span>em estoque</span>
                  </div>
                  <div className="managed-product-actions">
                    {canUpdateProduct ? (
                      <button
                        className="primary-button product-edit-button"
                        type="button"
                        onClick={() => void openProduct(product)}
                        disabled={Boolean(pending) || Boolean(openingProductId)}
                      >
                        {openingProductId === product.id ? (
                          <LoaderCircle className="spin" />
                        ) : (
                          <Pencil />
                        )}{" "}
                        {view === "variacoes"
                          ? "Editar variações"
                          : view === "midias"
                            ? "Gerenciar mídias"
                            : view === "estoque"
                              ? "Editar cadastro"
                              : "Editar"}
                      </button>
                    ) : null}
                    {canUpdateProduct ? (
                      <details className="product-action-menu">
                        <summary
                          className="secondary-button"
                          aria-label={`Mais ações para ${product.name}`}
                          title="Mais ações"
                        >
                          <MoreHorizontal />
                        </summary>
                        <div>
                          {capabilities.create ? (
                            <button
                              type="button"
                              onClick={() => setDuplicateTarget(product)}
                              disabled={Boolean(pending)}
                            >
                              <Copy /> Duplicar
                            </button>
                          ) : null}
                          {product.status === "active" ? (
                            <button
                              type="button"
                              disabled={Boolean(pending)}
                              onClick={() => void changeStatus(product, "inactive")}
                            >
                              <EyeOff /> Desativar
                            </button>
                          ) : product.status === "archived" ? (
                            <button
                              type="button"
                              disabled={Boolean(pending)}
                              onClick={() => void changeStatus(product, "draft")}
                            >
                              <RotateCcw /> Restaurar
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={
                                Boolean(pending) ||
                                !product.variants.some((variant) => variant.active)
                              }
                              title={
                                !product.variants.some((variant) => variant.active)
                                  ? "Cadastre e ative pelo menos uma variação antes de publicar."
                                  : "Publicar produto"
                              }
                              onClick={() => void changeStatus(product, "active")}
                            >
                              <Eye /> Publicar
                            </button>
                          )}
                          {product.status !== "archived" && capabilities.archive && (
                            <button
                              className="danger-action"
                              type="button"
                              onClick={() => {
                                setArchiveReason("");
                                setArchiveTarget(product);
                              }}
                              disabled={Boolean(pending)}
                            >
                              <Archive /> Arquivar produto
                            </button>
                          )}
                          {capabilities.delete && product.canDelete ? (
                            <button
                              className="danger-action"
                              type="button"
                              onClick={() => setDeleteTarget(product)}
                              disabled={Boolean(pending)}
                            >
                              <Trash2 /> Excluir permanentemente
                            </button>
                          ) : capabilities.delete ? (
                            <span className="product-delete-unavailable">
                              Possui registros relacionados; use Arquivar.
                            </span>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </header>
                <details
                  className="managed-product-details"
                  open={view !== "produtos" ? true : undefined}
                >
                  <summary>
                    <span>{viewCopy.detail}</span>
                    <small>
                      {product.variants.length} variação(ões) · {product.images?.length ?? 0}{" "}
                      imagem(ns)
                    </small>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="managed-product-detail-body">
                    {view !== "midias" ? (
                      <div className="managed-variant-list">
                        {product.variants.map((variant) => (
                          <div className="managed-variant" key={variant.id}>
                            <div>
                              <strong>{variant.sku}</strong>
                              <span>
                                {variant.color} · {variant.size}
                              </span>
                            </div>
                            <span>
                              Disponível: <strong>{variant.available}</strong>
                            </span>
                            <span>
                              Reservado: <strong>{variant.reserved}</strong>
                            </span>
                            {view !== "variacoes" && canAdjustStock ? (
                              <label>
                                <span>Adicionar</span>
                                <input
                                  ref={(element) => {
                                    quantities.current[variant.id] = element;
                                  }}
                                  type="number"
                                  min="1"
                                  max="99999"
                                  defaultValue="1"
                                  inputMode="numeric"
                                  aria-label={`Quantidade para ${variant.sku}`}
                                />
                              </label>
                            ) : null}
                            {view !== "variacoes" && canAdjustStock ? (
                              <label className="restock-reason">
                                <span>Motivo da reposição</span>
                                <input
                                  ref={(element) => {
                                    reasons.current[variant.id] = element;
                                  }}
                                  type="text"
                                  minLength={10}
                                  maxLength={500}
                                  placeholder="Ex.: entrada da nota 1234"
                                  aria-label={`Motivo da reposição de ${variant.sku}`}
                                />
                              </label>
                            ) : null}
                            {view !== "variacoes" && canAdjustStock ? (
                              <button
                                className="primary-button"
                                type="button"
                                disabled={
                                  Boolean(pending) ||
                                  !variant.active ||
                                  product.status === "archived"
                                }
                                onClick={() => {
                                  const quantity = Number(quantities.current[variant.id]?.value);
                                  if (!Number.isInteger(quantity) || quantity < 1) {
                                    setMessage("Informe uma quantidade inteira maior que zero.");
                                    return;
                                  }
                                  const reason = reasons.current[variant.id]?.value.trim() ?? "";
                                  if (reason.length < 10) {
                                    setMessage(
                                      "Informe um motivo de reposição com pelo menos 10 caracteres."
                                    );
                                    reasons.current[variant.id]?.focus();
                                    return;
                                  }
                                  void execute(
                                    {
                                      action: "restock",
                                      productId: product.id,
                                      variantId: variant.id,
                                      quantity,
                                      reason
                                    },
                                    variant.id
                                  );
                                }}
                              >
                                {pending === variant.id ? (
                                  <LoaderCircle className="spin" />
                                ) : (
                                  <PackagePlus />
                                )}
                                Repor
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {view !== "variacoes" && view !== "estoque" ? (
                      <section
                        className="managed-product-media"
                        aria-label={`Mídias de ${product.name}`}
                      >
                        <header>
                          <div>
                            <ImageIcon />
                            <strong>Fotos</strong>
                            <span>Galeria geral do produto.</span>
                          </div>
                          {canUpdateProduct ? (
                            <label className="secondary-button product-media-upload">
                              <Upload />{" "}
                              {pending === `media-${product.id}` ? "Enviando…" : "Enviar imagens"}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                multiple
                                disabled={Boolean(pending)}
                                onChange={(event) => {
                                  const files = [...(event.currentTarget.files ?? [])];
                                  event.currentTarget.value = "";
                                  void uploadMedia(product, files);
                                }}
                              />
                            </label>
                          ) : null}
                        </header>
                        {product.images?.length ? (
                          <div className="managed-media-grid">
                            {product.images.map((media) => (
                              <figure key={media.id}>
                                <Image
                                  src={media.url}
                                  alt={media.alt}
                                  width={120}
                                  height={120}
                                  unoptimized
                                />
                                <figcaption>
                                  {media.primary ? "Principal" : `Ordem ${media.sortOrder + 1}`}
                                </figcaption>
                                {canUpdateProduct ? (
                                  <div className="managed-media-actions">
                                    {!media.primary && (
                                      <button
                                        type="button"
                                        aria-label={`Definir ${media.alt} como principal`}
                                        disabled={Boolean(pending)}
                                        onClick={() =>
                                          void updateMedia({ action: "primary", imageId: media.id })
                                        }
                                      >
                                        <Star />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      aria-label={`Mover ${media.alt} para antes`}
                                      disabled={Boolean(pending)}
                                      onClick={() =>
                                        void updateMedia({
                                          action: "move",
                                          imageId: media.id,
                                          direction: "before"
                                        })
                                      }
                                    >
                                      <ChevronLeft />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Mover ${media.alt} para depois`}
                                      disabled={Boolean(pending)}
                                      onClick={() =>
                                        void updateMedia({
                                          action: "move",
                                          imageId: media.id,
                                          direction: "after"
                                        })
                                      }
                                    >
                                      <ChevronRight />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Remover ${media.alt}`}
                                      disabled={Boolean(pending)}
                                      onClick={() =>
                                        setMediaDeleteTarget({ id: media.id, alt: media.alt })
                                      }
                                    >
                                      <Trash2 />
                                    </button>
                                  </div>
                                ) : null}
                              </figure>
                            ))}
                          </div>
                        ) : (
                          <p>Nenhuma imagem enviada.</p>
                        )}
                      </section>
                    ) : null}
                  </div>
                </details>
              </article>
            ))}
          </div>
        </>
      )}

      {!loading && products.length > 0 ? (
        <footer className="admin-pagination">
          <span>{total.toLocaleString("pt-BR")} produtos</span>
          <div>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft />
            </button>
            <span>
              Página {page} de {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight />
            </button>
          </div>
        </footer>
      ) : null}

      {archiveTarget && (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="archive-product-title"
          >
            <h2 id="archive-product-title">Arquivar produto?</h2>
            <p>
              {archiveTarget.name} deixará de aparecer na loja. Pedidos antigos continuarão
              preservados.
            </p>
            <label>
              <span>Motivo do arquivamento</span>
              <textarea
                autoFocus
                rows={3}
                required
                minLength={3}
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                placeholder="Registre o motivo para a auditoria"
              />
            </label>
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setArchiveTarget(null);
                  setArchiveReason("");
                }}
                disabled={Boolean(pending)}
              >
                Cancelar
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                disabled={Boolean(pending) || archiveReason.trim().length < 3}
                onClick={() => {
                  const target = archiveTarget;
                  const reason = archiveReason.trim();
                  if (reason.length < 3) return;
                  void execute({ action: "archive", productId: target.id, reason }, target.id).then(
                    (ok) => {
                      if (ok) {
                        setArchiveTarget(null);
                        setArchiveReason("");
                      }
                    }
                  );
                }}
              >
                {pending === archiveTarget.id && <LoaderCircle className="spin" />}
                Arquivar produto
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="confirm-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-product-title"
          >
            <h2 id="delete-product-title">Excluir produto permanentemente?</h2>
            <p>
              <strong>{deleteTarget.name}</strong> será apagado com suas variações e imagens. Esta
              ação não pode ser desfeita.
            </p>
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(pending)}
              >
                Cancelar
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                onClick={() => void deleteProduct()}
                disabled={Boolean(pending)}
              >
                {pending === `delete-${deleteTarget.id}` && <LoaderCircle className="spin" />}
                Excluir permanentemente
              </button>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <PanelDrawer
          open
          size="large"
          eyebrow={editing === "new" ? "Novo cadastro" : "Edição de produto"}
          title={editing === "new" ? "Cadastrar produto" : editing.name}
          dirty={editorDirty && !pendingActionRef.current}
          onClose={closeEditor}
        >
          <div className="product-editor-drawer">
            <nav className="product-editor-nav" aria-label="Seções do cadastro">
              {productEditorSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={activeEditorSection === section.id ? "step" : undefined}
                  onClick={() => {
                    setActiveEditorSection(section.id);
                    document.getElementById(section.target)?.scrollIntoView({ block: "start" });
                  }}
                >
                  {section.label}
                </button>
              ))}
            </nav>
            <form
              ref={editorFormRef}
              onChangeCapture={() => setEditorDirty(true)}
              onSubmit={(event) => void saveProduct(event)}
            >
              <div className="admin-form-grid">
                <h3 className="wide product-form-section" id="product-step-1">
                  Informações do produto
                </h3>
                <p className="wide product-form-guidance">
                  Comece pelos dados que identificam o produto. Campos com * são obrigatórios.
                </p>
                <label>
                  <span>Nome *</span>
                  <input
                    name="name"
                    required
                    minLength={3}
                    defaultValue={editing === "new" ? "" : editing.name}
                    onBlur={(event) => {
                      const slug = event.currentTarget.form?.elements.namedItem("slug");
                      if (slug instanceof HTMLInputElement && !slug.value) {
                        slug.value = productSlug(event.currentTarget.value);
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Slug *</span>
                  <input
                    name="slug"
                    required
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    defaultValue={editing === "new" ? "" : editing.slug}
                  />
                </label>
                <p className="wide product-form-subsection">Organização no catálogo</p>
                <label>
                  <span>Categoria *</span>
                  <select
                    name="categoryId"
                    required
                    defaultValue={editing === "new" ? "" : editing.categoryId}
                  >
                    <option value="">Selecione</option>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Modelo</span>
                  <select name="modelId" defaultValue={editing === "new" ? "" : editing.modelId}>
                    <option value="">Sem modelo</option>
                    {models.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Coleção</span>
                  <select
                    name="collectionId"
                    defaultValue={editing === "new" ? "" : editing.collectionId}
                  >
                    <option value="">Sem coleção</option>
                    {collections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {editing === "new" ? (
                  <input name="status" type="hidden" value="draft" />
                ) : (
                  <>
                    <label>
                      <span>Status</span>
                      <select name="status" defaultValue={editing.status}>
                        <option value="draft">Rascunho</option>
                        <option value="pending_review">Em análise</option>
                        <option value="active">Publicado</option>
                        <option value="inactive">Inativo</option>
                        <option value="out_of_stock">Sem estoque</option>
                        <option value="rejected">Rejeitado</option>
                        {capabilities.archive || editing.status === "archived" ? (
                          <option value="archived">Arquivado</option>
                        ) : null}
                      </select>
                    </label>
                    <label>
                      <span>Motivo do status</span>
                      <input
                        name="statusReason"
                        defaultValue={editing.statusReason}
                        placeholder="Necessário ao inativar, rejeitar ou arquivar"
                      />
                    </label>
                  </>
                )}
                <h3 className="wide product-form-section" id="product-step-3">
                  Preço
                </h3>
                <label>
                  <span>Preço (R$) *</span>
                  <input
                    name="price"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={editing === "new" ? "" : (editing.priceInCents / 100).toFixed(2)}
                  />
                </label>
                <label>
                  <span>Preço anterior/promocional (R$)</span>
                  <input
                    name="compareAtPrice"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    defaultValue={
                      editing === "new" || !editing.compareAtPriceInCents
                        ? ""
                        : (editing.compareAtPriceInCents / 100).toFixed(2)
                    }
                  />
                </label>
                <label>
                  <span>Custo (R$) *</span>
                  <input
                    name="cost"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      editing === "new" ? "" : ((editing.costInCents ?? 0) / 100).toFixed(2)
                    }
                  />
                </label>
                <h3 className="wide product-form-section" id="product-step-4">
                  Imagens
                </h3>
                <p className="wide product-media-note">
                  {editing === "new"
                    ? "Escolha as imagens agora. Elas serão enviadas automaticamente quando o produto for criado."
                    : "Envie as fotos aqui e depois associe a imagem correta a cada cor."}
                </p>
                {editing === "new" ? (
                  <section className="wide product-editor-media" aria-label="Imagens selecionadas">
                    <header>
                      <div>
                        <strong>Galeria do produto</strong>
                        <span>JPG, PNG ou WebP de até 10 MB por imagem</span>
                      </div>
                      <label className="secondary-button product-media-upload">
                        <Upload /> Selecionar imagens
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          disabled={Boolean(pending)}
                          onChange={(event) => {
                            const files = [...(event.currentTarget.files ?? [])];
                            event.currentTarget.value = "";
                            selectNewProductMedia(files);
                          }}
                        />
                      </label>
                    </header>
                    {queuedMediaFiles.length ? (
                      <div className="product-media-queued-grid">
                        {queuedMediaFiles.map((file, index) => (
                          <QueuedProductImage
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            file={file}
                            index={index}
                            onRemove={() => {
                              setQueuedMediaFiles((current) =>
                                current.filter((candidate) => candidate !== file)
                              );
                              setEditorDirty(true);
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="product-media-empty">
                        <ImageIcon aria-hidden="true" />
                        <span>Nenhuma imagem selecionada.</span>
                      </div>
                    )}
                  </section>
                ) : (
                  <section className="wide product-editor-media" aria-label="Galeria do produto">
                    <header>
                      <div>
                        <strong>Galeria do produto</strong>
                        <span>Arraste as fotos para reordenar no computador</span>
                      </div>
                      <label className="secondary-button product-media-upload">
                        <Upload />{" "}
                        {pending === `media-${editing.id}` ? "Enviando…" : "Enviar imagens"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          disabled={Boolean(pending)}
                          onChange={(event) => {
                            const files = [...(event.currentTarget.files ?? [])];
                            event.currentTarget.value = "";
                            void uploadMedia(editing, files);
                          }}
                        />
                      </label>
                    </header>
                    {editing.images?.length ? (
                      <div className="product-editor-media-grid">
                        {editing.images.map((image) => (
                          <article
                            key={image.id}
                            draggable={!pending}
                            onDragStart={(event) => {
                              setDraggedMediaId(image.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", image.id);
                            }}
                            onDragEnd={() => setDraggedMediaId("")}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const sourceId =
                                draggedMediaId || event.dataTransfer.getData("text/plain");
                              setDraggedMediaId("");
                              if (sourceId && sourceId !== image.id) {
                                void updateMedia({
                                  action: "reorder",
                                  imageId: sourceId,
                                  targetImageId: image.id
                                });
                              }
                            }}
                          >
                            <Image
                              src={image.url}
                              alt={image.alt}
                              width={180}
                              height={180}
                              unoptimized
                            />
                            <div>
                              <label>
                                <span>Texto alternativo</span>
                                <input
                                  value={mediaAltTexts[image.id] ?? image.alt}
                                  minLength={3}
                                  maxLength={300}
                                  onChange={(event) =>
                                    setMediaAltTexts((current) => ({
                                      ...current,
                                      [image.id]: event.target.value
                                    }))
                                  }
                                />
                              </label>
                              <div className="product-editor-media-actions">
                                <button
                                  className="secondary-button"
                                  type="button"
                                  disabled={Boolean(pending)}
                                  onClick={() =>
                                    void updateMedia({
                                      action: "alt",
                                      imageId: image.id,
                                      alt: mediaAltTexts[image.id] ?? image.alt
                                    })
                                  }
                                >
                                  <Pencil /> Salvar texto
                                </button>
                                {!image.primary ? (
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label="Definir como imagem principal"
                                    disabled={Boolean(pending)}
                                    onClick={() =>
                                      void updateMedia({ action: "primary", imageId: image.id })
                                    }
                                  >
                                    <Star />
                                  </button>
                                ) : (
                                  <span className="status active">Principal</span>
                                )}
                                <button
                                  className="icon-button"
                                  type="button"
                                  aria-label="Mover imagem para antes"
                                  disabled={Boolean(pending)}
                                  onClick={() =>
                                    void updateMedia({
                                      action: "move",
                                      imageId: image.id,
                                      direction: "before"
                                    })
                                  }
                                >
                                  <ChevronLeft />
                                </button>
                                <button
                                  className="icon-button"
                                  type="button"
                                  aria-label="Mover imagem para depois"
                                  disabled={Boolean(pending)}
                                  onClick={() =>
                                    void updateMedia({
                                      action: "move",
                                      imageId: image.id,
                                      direction: "after"
                                    })
                                  }
                                >
                                  <ChevronRight />
                                </button>
                                <button
                                  className="icon-button danger-button"
                                  type="button"
                                  aria-label="Remover imagem"
                                  disabled={Boolean(pending)}
                                  onClick={() =>
                                    setMediaDeleteTarget({ id: image.id, alt: image.alt })
                                  }
                                >
                                  <Trash2 />
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>Nenhuma imagem enviada.</p>
                    )}
                  </section>
                )}
                <h3 className="wide product-form-section" id="product-step-5">
                  Variações por cor
                </h3>
                <p className="wide product-media-note">
                  Gere as combinações de cor e tamanho. Você também pode salvar um rascunho sem
                  variações e completar depois.
                </p>
                <div className="wide variant-generator">
                  <label>
                    <span>Prefixo do SKU</span>
                    <input
                      value={variantSkuPrefix}
                      onChange={(event) => setVariantSkuPrefix(event.target.value)}
                      placeholder="Ex.: SANDALIA-10"
                    />
                  </label>
                  <label>
                    <span>Cores, separadas por vírgula</span>
                    <input
                      value={variantColors}
                      onChange={(event) => setVariantColors(event.target.value)}
                      placeholder="Azul, Preto"
                    />
                  </label>
                  <label>
                    <span>Tamanhos, separados por vírgula</span>
                    <input
                      value={variantSizes}
                      onChange={(event) => setVariantSizes(event.target.value)}
                      placeholder="35, 36, 37"
                    />
                  </label>
                  <button className="secondary-button" type="button" onClick={generateVariants}>
                    Gerar combinações
                  </button>
                </div>
                <div className="wide product-variant-editor">
                  {editableVariants.length === 0 ? (
                    <p>
                      Nenhuma variação configurada. Rascunhos podem ser salvos assim; publique
                      somente após configurar os SKUs.
                    </p>
                  ) : (
                    groupedEditableVariants.map((group) => {
                      const variantIds = new Set(
                        group.variants.flatMap(({ variant }) => (variant.id ? [variant.id] : []))
                      );
                      const colorImages = editorImages.filter(
                        (image) => image.variantId && variantIds.has(image.variantId)
                      );
                      const selectedImageId =
                        colorImageSelections[group.key] ?? colorImages[0]?.id ?? "";
                      const selectedImage = editorImages.find(
                        (image) => image.id === selectedImageId
                      );
                      return (
                        <section className="variant-color-group" key={group.key}>
                          <header>
                            <span
                              className="variant-color-swatch"
                              style={{ backgroundColor: group.colorHex || "#f3f4f6" }}
                              aria-hidden="true"
                            />
                            <div>
                              <strong>{group.color}</strong>
                              <span>{group.variants.length} tamanho(s)</span>
                            </div>
                            <label className="variant-color-name">
                              <span>Nome da cor</span>
                              <input
                                required
                                value={group.color === "Sem cor" ? "" : group.color}
                                onChange={(event) => {
                                  const color = event.target.value;
                                  group.variants.forEach(({ index }) =>
                                    updateEditableVariant(index, { color })
                                  );
                                }}
                              />
                            </label>
                            <label className="variant-color-picker">
                              <span>Cor visual</span>
                              <input
                                type="color"
                                value={group.colorHex || "#000000"}
                                onChange={(event) =>
                                  group.variants.forEach(({ index }) =>
                                    updateEditableVariant(index, {
                                      colorHex: event.target.value
                                    })
                                  )
                                }
                              />
                            </label>
                          </header>
                          <div className="variant-size-list">
                            {group.variants.map(({ variant, index }) => (
                              <article
                                key={variant.id ?? `${variant.color}-${variant.size}-${index}`}
                              >
                                <label>
                                  <span>Tamanho *</span>
                                  <input
                                    required
                                    value={variant.size}
                                    onChange={(event) =>
                                      updateEditableVariant(index, { size: event.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>SKU *</span>
                                  <input
                                    required
                                    value={variant.sku}
                                    onChange={(event) =>
                                      updateEditableVariant(index, { sku: event.target.value })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Preço próprio (R$)</span>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.01"
                                    value={
                                      variant.priceInCents === null
                                        ? ""
                                        : variant.priceInCents / 100
                                    }
                                    onChange={(event) =>
                                      updateEditableVariant(index, {
                                        priceInCents: event.target.value
                                          ? Math.round(Number(event.target.value) * 100)
                                          : null
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Estoque *</span>
                                  <input
                                    required
                                    disabled={!canAdjustStock}
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    step="1"
                                    value={variant.stock}
                                    onChange={(event) =>
                                      updateEditableVariant(index, {
                                        stock: Math.max(0, Number(event.target.value) || 0)
                                      })
                                    }
                                  />
                                </label>
                                <label className="admin-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={variant.active}
                                    onChange={(event) =>
                                      updateEditableVariant(index, {
                                        active: event.target.checked
                                      })
                                    }
                                  />
                                  <span>Ativa</span>
                                </label>
                                <button
                                  className="icon-button"
                                  type="button"
                                  aria-label={`Duplicar ${variant.sku}`}
                                  onClick={() => duplicateVariant(variant)}
                                >
                                  <Copy />
                                </button>
                                <button
                                  className="icon-button danger-button"
                                  type="button"
                                  aria-label={`Remover ${variant.sku}`}
                                  onClick={() => {
                                    setEditorDirty(true);
                                    setEditableVariants((current) =>
                                      current.filter((_, itemIndex) => itemIndex !== index)
                                    );
                                  }}
                                >
                                  <Trash2 />
                                </button>
                              </article>
                            ))}
                          </div>
                          <div className="variant-color-tools">
                            <label>
                              <span>Adicionar tamanho nesta cor</span>
                              <input
                                value={newVariantSizes[group.key] ?? ""}
                                onChange={(event) =>
                                  setNewVariantSizes((current) => ({
                                    ...current,
                                    [group.key]: event.target.value
                                  }))
                                }
                                placeholder="Ex.: 38"
                              />
                            </label>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => addSizeToColor(group.key, group.color, group.colorHex)}
                            >
                              <Plus /> Adicionar tamanho
                            </button>
                          </div>
                          {editing !== "new" ? (
                            <div className="variant-color-media">
                              <div>
                                <strong>Imagem desta cor</strong>
                                <span>Escolha uma foto da galeria geral.</span>
                              </div>
                              <div className="variant-color-thumbnails">
                                {selectedImage ? (
                                  <Image
                                    src={selectedImage.url}
                                    alt={selectedImage.alt}
                                    width={52}
                                    height={52}
                                    unoptimized
                                  />
                                ) : null}
                              </div>
                              <label className="variant-color-image-select">
                                <span>Imagem selecionada</span>
                                <select
                                  value={selectedImageId}
                                  disabled={!editorImages.length}
                                  onChange={(event) => {
                                    setColorImageSelections((current) => ({
                                      ...current,
                                      [group.key]: event.target.value
                                    }));
                                    setEditorDirty(true);
                                  }}
                                >
                                  <option value="">Sem imagem específica</option>
                                  {editorImages.map((image, index) => (
                                    <option key={image.id} value={image.id}>
                                      {image.primary ? "Principal" : `Imagem ${index + 1}`} —{" "}
                                      {image.alt}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ) : null}
                        </section>
                      );
                    })
                  )}
                </div>
                {editableVariants.length ? (
                  <label className="wide product-stock-reason">
                    <span>Motivo da definição do estoque *</span>
                    <input
                      name="stockReason"
                      required
                      minLength={10}
                      maxLength={500}
                      defaultValue="Estoque definido no cadastro do produto"
                    />
                    <small>Este registro é usado na auditoria das quantidades informadas.</small>
                  </label>
                ) : (
                  <input
                    name="stockReason"
                    type="hidden"
                    value="Cadastro inicial sem variações de estoque"
                  />
                )}
                <h3 className="wide product-form-section" id="product-step-7">
                  Dimensões e transporte
                </h3>
                <label>
                  <span>Peso (g) *</span>
                  <input
                    name="weightGrams"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    required
                    defaultValue={editing === "new" ? "" : editing.weightGrams}
                  />
                </label>
                <label>
                  <span>Altura (cm) *</span>
                  <input
                    name="heightCm"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={editing === "new" ? "" : editing.heightCm}
                  />
                </label>
                <label>
                  <span>Largura (cm) *</span>
                  <input
                    name="widthCm"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={editing === "new" ? "" : editing.widthCm}
                  />
                </label>
                <label>
                  <span>Comprimento (cm) *</span>
                  <input
                    name="lengthCm"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={editing === "new" ? "" : editing.lengthCm}
                  />
                </label>
                <h3 className="wide product-form-section" id="product-step-8">
                  Conteúdo do produto
                </h3>
                <label className="wide">
                  <span>Descrição curta *</span>
                  <input
                    name="shortDescription"
                    required
                    minLength={3}
                    maxLength={280}
                    defaultValue={editing === "new" ? "" : editing.shortDescription}
                  />
                </label>
                <label className="wide">
                  <span>Descrição detalhada *</span>
                  <textarea
                    name="description"
                    required
                    minLength={3}
                    maxLength={4000}
                    rows={5}
                    defaultValue={editing === "new" ? "" : editing.description}
                  />
                </label>
                <p className="wide product-form-subsection">Busca e visibilidade</p>
                <label className="wide">
                  <span>Título SEO</span>
                  <input
                    name="seoTitle"
                    maxLength={160}
                    defaultValue={editing === "new" ? "" : editing.seoTitle}
                  />
                </label>
                <label className="wide">
                  <span>Descrição SEO</span>
                  <textarea
                    name="seoDescription"
                    maxLength={320}
                    rows={3}
                    defaultValue={editing === "new" ? "" : editing.seoDescription}
                  />
                </label>
                <label className="admin-checkbox">
                  <input
                    name="featured"
                    type="checkbox"
                    defaultChecked={editing !== "new" && editing.featured}
                  />
                  <span>Produto em destaque</span>
                </label>
              </div>
              <footer className="product-editor-footer">
                <span>Atalho: Ctrl/Cmd + S</span>
                <button className="primary-button" type="submit" disabled={Boolean(pending)}>
                  {pending && <LoaderCircle className="spin" />}
                  {pending
                    ? "Salvando…"
                    : editing === "new"
                      ? queuedMediaFiles.length
                        ? `Criar e enviar ${queuedMediaFiles.length} imagem(ns)`
                        : "Criar rascunho"
                      : "Salvar alterações"}
                </button>
              </footer>
            </form>
          </div>
        </PanelDrawer>
      )}

      {mediaDeleteTarget && (
        <div className="admin-modal-backdrop" role="presentation">
          <section
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-media-title"
          >
            <h2 id="delete-media-title">Remover imagem?</h2>
            <p>
              A imagem <strong>{mediaDeleteTarget.alt}</strong> será removida permanentemente do
              produto.
            </p>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => setMediaDeleteTarget(null)}
              >
                Cancelar
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => void deleteMedia(mediaDeleteTarget.id)}
              >
                {pending === `image-${mediaDeleteTarget.id}` && <LoaderCircle className="spin" />}
                Remover imagem
              </button>
            </div>
          </section>
        </div>
      )}

      {statusTarget && (
        <div className="admin-modal-backdrop" role="presentation">
          <section
            className="admin-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-status-title"
          >
            <h2 id="product-status-title">
              Alterar status para {productStatusLabel(statusTarget.nextStatus)}
            </h2>
            <p>
              Registre o motivo auditável para alterar o status de{" "}
              <strong>{statusTarget.product.name}</strong>.
            </p>
            <label>
              <span>Motivo da alteração</span>
              <textarea
                autoFocus
                rows={3}
                minLength={3}
                maxLength={500}
                required
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
              />
            </label>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => setStatusTarget(null)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={Boolean(pending) || statusReason.trim().length < 3}
                onClick={() =>
                  void changeStatus(statusTarget.product, statusTarget.nextStatus, statusReason)
                }
              >
                {pending === statusTarget.product.id && <LoaderCircle className="spin" />}
                Confirmar alteração
              </button>
            </div>
          </section>
        </div>
      )}

      {duplicateTarget && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-title"
          >
            <h2 id="duplicate-title">Duplicar produto</h2>
            <p>A cópia será criada como rascunho, com variações e estoque zerado.</p>
            <form
              className="duplicate-product-form"
              onSubmit={(event) => void duplicateProduct(event)}
            >
              <label>
                <span>Novo nome</span>
                <input
                  name="name"
                  required
                  minLength={3}
                  defaultValue={`${duplicateTarget.name} — cópia`}
                />
              </label>
              <label>
                <span>Novo slug</span>
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  defaultValue={`${duplicateTarget.slug}-copia`}
                />
              </label>
              <div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setDuplicateTarget(null)}
                >
                  Cancelar
                </button>
                <button className="primary-button" type="submit" disabled={Boolean(pending)}>
                  {pending && <LoaderCircle className="spin" />} Duplicar
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
