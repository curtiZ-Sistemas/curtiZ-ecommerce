"use client";

import {
  Archive,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ImageIcon,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type EditableVariant,
  generateVariantCombinations,
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

const productStatusLabel = (status: string) => ({
  draft: "Rascunho",
  pending_review: "Em análise",
  active: "Publicado",
  inactive: "Inativo",
  out_of_stock: "Sem estoque",
  archived: "Arquivado",
  rejected: "Rejeitado"
}[status] ?? status);

export function ProductManagement() {
  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [filter, setFilter] = useState<"all" | "out">("all");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ManagedProduct | null>(null);
  const [editing, setEditing] = useState<ManagedProduct | "new" | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<ManagedProduct | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [editableVariants, setEditableVariants] = useState<EditableVariant[]>([]);
  const [variantColors, setVariantColors] = useState("");
  const [variantSizes, setVariantSizes] = useState("");
  const [variantSkuPrefix, setVariantSkuPrefix] = useState("");
  const [mediaColors, setMediaColors] = useState<Record<string, string>>( {} );
  const quantities = useRef<Record<string, HTMLInputElement | null>>({});
  const reasons = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (submittedQuery) params.set("q", submittedQuery);
      if (status) params.set("status", status);
      if (filter === "out") params.set("stock", "out");
      const response = await fetch(`/api/catalog/products?${params}`, { cache: "no-store" });
      const result = (await response.json()) as CatalogResponse;
      if (!response.ok) throw new Error(result.message);
      setProducts(result.products ?? []);
      setCategories(result.categories ?? []);
      setModels(result.models ?? []);
      setCollections(result.collections ?? []);
      setTotal(result.total ?? 0);
      setPageSize(result.pageSize ?? 20);
    } catch {
      setMessage("Não foi possível carregar os produtos agora.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, status, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    if (editing === "new") {
      setEditableVariants([]);
      setVariantColors("");
      setVariantSizes("");
      setVariantSkuPrefix("");
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
    setVariantSkuPrefix(editing.slug);
    setVariantColors("");
    setVariantSizes("");
  }, [editing]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const execute = async (body: Record<string, unknown>, key: string) => {
    if (pending) return false;
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
      if (response.ok) await load();
      return response.ok;
    } catch {
      setMessage("Não foi possível concluir a alteração agora.");
      return false;
    } finally {
      setPending("");
    }
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const success = await execute(
      {
        action: "save",
        ...(editing === "new" ? {} : { productId: editing.id }),
        name: form.get("name"),
        slug: form.get("slug"),
        shortDescription: form.get("shortDescription"),
        description: form.get("description"),
        categoryId: form.get("categoryId"),
        modelId: form.get("modelId") || null,
        collectionId: form.get("collectionId") || null,
        status: form.get("status"),
        statusReason: form.get("statusReason"),
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
      editing === "new" ? "new-product" : editing.id
    );
    if (success) setEditing(null);
  };

  const changeStatus = async (product: ManagedProduct, nextStatus: string) => {
    const needsReason = ["inactive", "archived", "rejected"].includes(nextStatus);
    const reason = needsReason
      ? window.prompt(`Informe o motivo para alterar o status para ${productStatusLabel(nextStatus)}:`)?.trim()
      : undefined;
    if (needsReason && !reason) return;
    await execute({ action: "status", productId: product.id, status: nextStatus, reason }, product.id);
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

  const updateEditableVariant = (index: number, value: Partial<EditableVariant>) =>
    setEditableVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, ...value } : variant
      )
    );

  const generateVariants = () => {
    const generated = generateVariantCombinations(variantColors, variantSizes, variantSkuPrefix);
    if (!generated.length) {
      setMessage("Informe um prefixo de SKU, pelo menos uma cor e um tamanho.");
      return;
    }
    setEditableVariants((current) => {
      const byCombination = new Map(
        current.map((variant) => [`${variant.color.toLocaleLowerCase("pt-BR")}::${variant.size.toLocaleLowerCase("pt-BR")}`, variant])
      );
      return generated.map((variant) =>
        byCombination.get(`${variant.color.toLocaleLowerCase("pt-BR")}::${variant.size.toLocaleLowerCase("pt-BR")}`) ?? variant
      );
    });
    setMessage(`${generated.length} combinações preparadas. Revise SKU e estoque antes de salvar.`);
  };

  const uploadMedia = async (product: ManagedProduct, files: FileList | null) => {
    if (!files?.length || pending) return;
    setPending(`media-${product.id}`);
    setMessage("");
    try {
      let uploaded = 0;
      for (const [index, file] of [...files].entries()) {
        const form = new FormData();
        form.set("productId", product.id);
        form.set("file", file);
        form.set("alt", `${product.name}${mediaColors[product.id] ? ` - ${mediaColors[product.id]}` : ""}`);
        form.set("color", mediaColors[product.id] ?? "");
        form.set("primary", String((product.images?.length ?? 0) === 0 && index === 0));
        const response = await fetch("/api/catalog/products/media", { method: "POST", body: form });
        const result = (await response.json()) as CatalogResponse;
        if (!response.ok) throw new Error(result.message ?? "Falha no upload.");
        uploaded += 1;
      }
      setMessage(`${uploaded} imagem(ns) adicionada(s) ao produto.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar as imagens.");
    } finally {
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
      if (response.ok) await load();
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
      setMessage(result.message ?? (response.ok ? "Mídia atualizada." : "Falha ao atualizar mídia."));
      if (response.ok) await load();
    } finally {
      setPending("");
    }
  };

  return (
    <section className="panel-card product-management">
      <div className="page-heading">
        <div>
          <h2>Produtos</h2>
          <p>Cadastre, publique, duplique e mantenha catálogo, SEO e estoque.</p>
        </div>
        <div className="product-header-actions">
          <button className="primary-button" type="button" onClick={() => setEditing("new")}>
            <Plus /> Novo produto
          </button>
          <div className="product-filter-tabs" role="group" aria-label="Filtrar produtos">
            <button
              className={filter === "all" ? "secondary-button active" : "secondary-button"}
              type="button"
              onClick={() => {
                setPage(1);
                setFilter("all");
              }}
            >
              Todos
            </button>
            <button
              className={filter === "out" ? "secondary-button active" : "secondary-button"}
              type="button"
              onClick={() => {
                setPage(1);
                setFilter("out");
              }}
            >
              Produtos sem estoque
            </button>
          </div>
        </div>
      </div>

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
      ) : products.length === 0 ? (
        <div className="operational-empty">
          <Boxes />
          <strong>Nenhum produto encontrado</strong>
        </div>
      ) : (
        <div className="managed-product-list">
          {products.map((product) => (
            <article className="managed-product" key={product.id}>
              <header>
                <div>
                  <h3>{product.name}</h3>
                  <span>
                    {formatBRL(product.priceInCents)} ·{" "}
                    {productStatusLabel(product.status)}
                  </span>
                </div>
                <div>
                  <strong>{product.stock}</strong>
                  <span>disponível para venda</span>
                </div>
                <div className="managed-product-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setEditing(product)}
                    disabled={Boolean(pending)}
                  >
                    <Pencil /> Editar
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDuplicateTarget(product)}
                    disabled={Boolean(pending)}
                  >
                    <Copy /> Duplicar
                  </button>
                  {product.status === "active" ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(pending)}
                      onClick={() => void changeStatus(product, "inactive")}
                    >
                      <EyeOff /> Desativar
                    </button>
                  ) : product.status === "archived" ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(pending)}
                      onClick={() => void changeStatus(product, "draft")}
                    >
                      <RotateCcw /> Restaurar
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(pending)}
                      onClick={() => void changeStatus(product, "active")}
                    >
                      <Eye /> Publicar
                    </button>
                  )}
                  {product.status !== "archived" && (
                    <button
                      className="secondary-button danger-button"
                      type="button"
                      onClick={() => setArchiveTarget(product)}
                      disabled={Boolean(pending)}
                    >
                      <Archive /> Arquivar produto
                    </button>
                  )}
                </div>
              </header>
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
                    <button
                      className="primary-button"
                      type="button"
                      disabled={
                        Boolean(pending) || !variant.active || product.status === "archived"
                      }
                      onClick={() => {
                        const quantity = Number(quantities.current[variant.id]?.value);
                        if (!Number.isInteger(quantity) || quantity < 1) {
                          setMessage("Informe uma quantidade inteira maior que zero.");
                          return;
                        }
                        const reason = reasons.current[variant.id]?.value.trim() ?? "";
                        if (reason.length < 10) {
                          setMessage("Informe um motivo de reposição com pelo menos 10 caracteres.");
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
                      {pending === variant.id ? <LoaderCircle className="spin" /> : <PackagePlus />}
                      Repor
                    </button>
                  </div>
                ))}
              </div>
              <section className="managed-product-media" aria-label={`Mídias de ${product.name}`}>
                <header>
                  <div><ImageIcon /><strong>Fotos</strong><span>Envie várias imagens e associe-as à cor selecionada.</span></div>
                  <select
                    aria-label={`Cor das novas imagens de ${product.name}`}
                    value={mediaColors[product.id] ?? ""}
                    onChange={(event) => setMediaColors((current) => ({ ...current, [product.id]: event.target.value }))}
                  >
                    <option value="">Todas as cores</option>
                    {[...new Set(product.variants.map((variant) => variant.color).filter(Boolean))].map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                  <label className="secondary-button product-media-upload">
                    <Upload /> {pending === `media-${product.id}` ? "Enviando…" : "Enviar imagens"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={Boolean(pending)} onChange={(event) => void uploadMedia(product, event.target.files)} />
                  </label>
                </header>
                {product.images?.length ? <div className="managed-media-grid">{product.images.map((media) => (
                  <figure key={media.id}>
                    <Image src={media.url} alt={media.alt} width={120} height={120} unoptimized />
                    <figcaption>{media.primary ? "Principal" : `Ordem ${media.sortOrder + 1}`}</figcaption>
                    <div className="managed-media-actions">
                      {!media.primary && <button type="button" aria-label={`Definir ${media.alt} como principal`} disabled={Boolean(pending)} onClick={() => void updateMedia({ action: "primary", imageId: media.id })}><Star /></button>}
                      <button type="button" aria-label={`Mover ${media.alt} para antes`} disabled={Boolean(pending)} onClick={() => void updateMedia({ action: "move", imageId: media.id, direction: "before" })}><ChevronLeft /></button>
                      <button type="button" aria-label={`Mover ${media.alt} para depois`} disabled={Boolean(pending)} onClick={() => void updateMedia({ action: "move", imageId: media.id, direction: "after" })}><ChevronRight /></button>
                      <button type="button" aria-label={`Remover ${media.alt}`} disabled={Boolean(pending)} onClick={() => void deleteMedia(media.id)}><Trash2 /></button>
                    </div>
                  </figure>
                ))}</div> : <p>Nenhuma imagem enviada.</p>}
              </section>
            </article>
          ))}
        </div>
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
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setArchiveTarget(null)}
                disabled={Boolean(pending)}
              >
                Não
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                disabled={Boolean(pending)}
                onClick={() => {
                  const target = archiveTarget;
                  const reason = window.prompt("Informe o motivo do arquivamento:")?.trim();
                  if (!reason) return;
                  void execute({ action: "archive", productId: target.id, reason }, target.id).then(
                    (ok) => {
                      if (ok) setArchiveTarget(null);
                    }
                  );
                }}
              >
                {pending === archiveTarget.id && <LoaderCircle className="spin" />}
                Sim
              </button>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-modal product-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-editor-title"
          >
            <header>
              <div>
                <span>{editing === "new" ? "Novo cadastro" : "Edição"}</span>
                <h2 id="product-editor-title">Produto</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar">
                <X />
              </button>
            </header>
            <nav className="product-editor-steps" aria-label="Etapas do cadastro">
              {[
                "Informações", "Categoria", "Preço", "Variações", "Estoque",
                "Dimensões", "Fotos", "Descrições", "SEO", "Revisão"
              ].map((label, index) => (
                <a href={`#product-step-${index + 1}`} key={label}>
                  <span>{index + 1}</span>{label}
                </a>
              ))}
            </nav>
            <form onSubmit={(event) => void saveProduct(event)}>
              <div className="admin-form-grid">
                <h3 className="wide product-form-section" id="product-step-1">1. Informações</h3>
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
                <h3 className="wide product-form-section" id="product-step-2">2. Categoria, modelo e coleção</h3>
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
                <label>
                  <span>Status</span>
                  <select name="status" defaultValue={editing === "new" ? "draft" : editing.status}>
                    <option value="draft">Rascunho</option>
                    <option value="pending_review">Em análise</option>
                    <option value="active">Publicado</option>
                    <option value="inactive">Inativo</option>
                    <option value="out_of_stock">Sem estoque</option>
                    <option value="rejected">Rejeitado</option>
                    <option value="archived">Arquivado</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Motivo do status</span>
                  <textarea name="statusReason" rows={3} defaultValue={editing === "new" ? "" : editing.statusReason} placeholder="Obrigatório para inativar, rejeitar ou arquivar" />
                </label>
                <h3 className="wide product-form-section" id="product-step-3">3. Preço</h3>
                <label>
                  <span>Preço (R$) *</span>
                  <input
                    name="price"
                    type="number"
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
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      editing === "new" ? "" : ((editing.costInCents ?? 0) / 100).toFixed(2)
                    }
                  />
                </label>
                <h3 className="wide product-form-section" id="product-step-4">4. Variações</h3>
                <div className="wide variant-generator">
                  <label><span>Prefixo do SKU</span><input value={variantSkuPrefix} onChange={(event) => setVariantSkuPrefix(event.target.value)} placeholder="Ex.: SANDALIA-10" /></label>
                  <label><span>Cores, separadas por vírgula</span><input value={variantColors} onChange={(event) => setVariantColors(event.target.value)} placeholder="Azul, Preto" /></label>
                  <label><span>Tamanhos, separados por vírgula</span><input value={variantSizes} onChange={(event) => setVariantSizes(event.target.value)} placeholder="35, 36, 37" /></label>
                  <button className="secondary-button" type="button" onClick={generateVariants}>Gerar combinações</button>
                </div>
                <div className="wide product-variant-editor">
                  {editableVariants.length === 0 ? (
                    <p>Nenhuma variação configurada. Rascunhos podem ser salvos assim; publique somente após configurar os SKUs.</p>
                  ) : editableVariants.map((variant, index) => (
                    <article key={variant.id ?? `${variant.color}-${variant.size}-${index}`}>
                      <label><span>SKU *</span><input required value={variant.sku} onChange={(event) => updateEditableVariant(index, { sku: event.target.value })} /></label>
                      <label><span>Cor *</span><input required value={variant.color} onChange={(event) => updateEditableVariant(index, { color: event.target.value })} /></label>
                      <label><span>Cor visual</span><input type="color" value={variant.colorHex || "#000000"} onChange={(event) => updateEditableVariant(index, { colorHex: event.target.value })} /></label>
                      <label><span>Tamanho *</span><input required value={variant.size} onChange={(event) => updateEditableVariant(index, { size: event.target.value })} /></label>
                      <label><span>Preço próprio (R$)</span><input type="number" min="0" step="0.01" value={variant.priceInCents === null ? "" : variant.priceInCents / 100} onChange={(event) => updateEditableVariant(index, { priceInCents: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} /></label>
                      <label><span>Estoque disponível *</span><input required type="number" min="0" step="1" value={variant.stock} onChange={(event) => updateEditableVariant(index, { stock: Math.max(0, Number(event.target.value) || 0) })} /></label>
                      <label className="admin-checkbox"><input type="checkbox" checked={variant.active} onChange={(event) => updateEditableVariant(index, { active: event.target.checked })} /><span>Ativa</span></label>
                      <button className="icon-button danger-button" type="button" aria-label={`Remover ${variant.sku}`} onClick={() => setEditableVariants((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button>
                    </article>
                  ))}
                </div>
                <h3 className="wide product-form-section" id="product-step-5">5. Estoque</h3>
                <label className="wide">
                  <span>Motivo do estoque *</span>
                  <input name="stockReason" required minLength={10} defaultValue="Estoque definido no cadastro do produto" />
                </label>
                <h3 className="wide product-form-section" id="product-step-6">6. Dimensões e transporte</h3>
                <label>
                  <span>Peso (g) *</span>
                  <input
                    name="weightGrams"
                    type="number"
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
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={editing === "new" ? "" : editing.lengthCm}
                  />
                </label>
                <h3 className="wide product-form-section" id="product-step-7">7. Fotos</h3>
                <p className="wide product-media-note">Salve o produto e use a área Mídias para enviar arquivos sem informar UUID ou caminho de Storage.</p>
                <h3 className="wide product-form-section" id="product-step-8">8. Descrições</h3>
                <label className="wide">
                  <span>Descrição curta *</span>
                  <input
                    name="shortDescription"
                    required
                    defaultValue={editing === "new" ? "" : editing.shortDescription}
                  />
                </label>
                <label className="wide">
                  <span>Descrição detalhada *</span>
                  <textarea
                    name="description"
                    required
                    rows={5}
                    defaultValue={editing === "new" ? "" : editing.description}
                  />
                </label>
                <h3 className="wide product-form-section" id="product-step-9">9. SEO</h3>
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
                <h3 className="wide product-form-section" id="product-step-10">10. Revisão</h3>
                <p className="wide product-review-note">Revise status, preços, variações e estoque. O salvamento é transacional: nenhuma parte será persistida se outra falhar.</p>
              </div>
              <footer>
                <button className="secondary-button" type="button" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button className="primary-button" type="submit" disabled={Boolean(pending)}>
                  {pending && <LoaderCircle className="spin" />} Salvar produto
                </button>
              </footer>
            </form>
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
