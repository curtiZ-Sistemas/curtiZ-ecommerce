"use client";

import {
  Archive,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type ManagedProduct } from "@/lib/product-management";

type CatalogResponse = {
  products?: ManagedProduct[];
  categories?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string }>;
  collections?: Array<{ id: string; name: string }>;
  total?: number;
  pageSize?: number;
  message?: string;
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

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
        costInCents: Math.round(Number(form.get("cost")) * 100),
        weightGrams: Number(form.get("weightGrams")),
        heightCm: Number(form.get("heightCm")),
        widthCm: Number(form.get("widthCm")),
        lengthCm: Number(form.get("lengthCm")),
        seoTitle: form.get("seoTitle"),
        seoDescription: form.get("seoDescription")
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
                      <Archive /> Excluir produto
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
            <h2 id="archive-product-title">Excluir produto?</h2>
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
            <form onSubmit={(event) => void saveProduct(event)}>
              <div className="admin-form-grid">
                <label>
                  <span>Nome *</span>
                  <input
                    name="name"
                    required
                    minLength={3}
                    defaultValue={editing === "new" ? "" : editing.name}
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
                <label className="wide">
                  <span>Descrição curta *</span>
                  <input
                    name="shortDescription"
                    required
                    defaultValue={editing === "new" ? "" : editing.shortDescription}
                  />
                </label>
                <label className="wide">
                  <span>Descrição *</span>
                  <textarea
                    name="description"
                    required
                    rows={5}
                    defaultValue={editing === "new" ? "" : editing.description}
                  />
                </label>
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
