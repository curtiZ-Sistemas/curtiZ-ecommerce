"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  X
} from "lucide-react";
import { publicCatalogMediaUrl } from "@/lib/public-media";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  adminResources,
  type AdminResourceField,
  type AdminResourceKey
} from "@/lib/admin-resources";

type Item = Record<string, unknown>;

type ListResponse = {
  items?: Item[];
  total?: number;
  page?: number;
  pageSize?: number;
  message?: string;
  capabilities?: ResourceCapabilities;
};

type ResourceCapabilities = {
  create: boolean;
  update: boolean;
  archive: boolean;
};

const noCapabilities: ResourceCapabilities = {
  create: false,
  update: false,
  archive: false
};

function isRecord(value: unknown): value is Item {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseListResponse(value: unknown): ListResponse {
  if (!isRecord(value)) return {};

  const capabilities = isRecord(value.capabilities)
    ? {
        create: value.capabilities.create === true,
        update: value.capabilities.update === true,
        archive: value.capabilities.archive === true
      }
    : undefined;

  return {
    items: Array.isArray(value.items) ? value.items.filter(isRecord) : undefined,
    total: readNumber(value.total),
    page: readNumber(value.page),
    pageSize: readNumber(value.pageSize),
    message: typeof value.message === "string" ? value.message : undefined,
    capabilities
  };
}

async function readListResponse(response: Response): Promise<ListResponse> {
  const payload: unknown = await response.json();
  return parseListResponse(payload);
}

function scalarToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

const columnLabels: Record<string, string> = {
  public_code: "Código",
  customer_email_snapshot: "Cliente",
  payment_status: "Pagamento",
  shipment_status: "Envio",
  grand_total: "Total",
  full_name: "Nome",
  email_snapshot: "E-mail",
  product_id: "Produto",
  variant_id: "Variação",
  representative_id: "Representante",
  current_level_id: "Nível",
  region_code: "Região",
  verified_purchase: "Compra verificada",
  brand_response: "Resposta da curti Z",
  storage_path: "Arquivo",
  accepted_at: "Aceito em"
};

const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  draft: "Rascunho",
  pending: "Pendente",
  pending_review: "Em análise",
  approved: "Aprovado",
  published: "Publicado",
  archived: "Arquivado",
  rejected: "Rejeitado",
  reported: "Denunciado",
  scheduled: "Agendado",
  expired: "Expirado",
  hidden: "Oculto",
  suspended: "Suspenso",
  cancelled: "Cancelado"
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const dateTimeInput = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo"
});

function displayValue(value: unknown, column: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") {
    if (statusLabels[value]) return statusLabels[value];
    if (column.endsWith("_at")) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return dateTime.format(parsed);
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "—";
    } catch {
      return "—";
    }
  }

  return "—";
}

function columnLabel(column: string, fields: readonly AdminResourceField[]): string {
  return (
    fields.find((field) => field.key === column)?.label ??
    columnLabels[column] ??
    column.replaceAll("_", " ")
  );
}

function itemId(item: Item): string {
  if (typeof item.id === "string") return item.id;
  if (typeof item.key === "string") return item.key;
  return "";
}

function fieldValue(item: Item, field: AdminResourceField): unknown {
  const value = item[field.key];

  if (field.type === "datetime" && typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ""
      : dateTimeInput.format(parsed).replace(" ", "T");
  }

  if (field.type === "json" && value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return value ?? "";
}

function formValue(value: unknown): string {
  return scalarToString(value);
}

function getFormValue(form: FormData, field: AdminResourceField): unknown {
  if (field.type === "boolean") {
    return form.get(field.key) === "on";
  }

  const value = form.get(field.key);
  return typeof value === "string" ? value : "";
}

export function AdminResourceManager({
  resource
}: {
  resource: AdminResourceKey;
}) {
  const definition = adminResources[resource];
  const createLabel = createActionLabel(resource, definition.singular);
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] =
    useState<ResourceCapabilities>(noCapabilities);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stateTarget, setStateTarget] = useState<{
    items: Item[];
    action: "archive" | "restore";
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    const params = new URLSearchParams({
      page: String(page)
    });

    if (submittedQuery) params.set("q", submittedQuery);
    if (status) params.set("status", status);

    try {
      const response = await fetch(`/api/admin/resources/${resource}?${params}`, {
        cache: "no-store"
      });
      const result = await readListResponse(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível carregar os registros.");
      }

      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setPageSize(result.pageSize ?? 20);
      setCapabilities(result.capabilities ?? noCapabilities);
      setSelectedIds([]);
    } catch (error) {
      setItems([]);
      setTotal(0);
      setCapabilities(noCapabilities);
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível carregar os registros agora."
      );
    } finally {
      setLoading(false);
    }
  }, [page, resource, status, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusField = definition.fields.find(
    (field) => field.key === "status" || field.key === "active"
  );

  const columns = useMemo(() => {
    const keys = definition.select
      .split(",")
      .map((key) => key.trim())
      .filter((key) => !["id", "updated_at", "created_at", "edited_at"].includes(key));

    return keys.slice(0, 5);
  }, [definition.select]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selectionLabelColumn = columns[0] ?? "id";
  const canCreate = definition.allowCreate && capabilities.create;
  const canUpdate = definition.allowCreate && capabilities.update;
  const canArchive = definition.allowArchive && capabilities.archive;

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending || !editing) return;

    setPending(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};

    for (const field of definition.fields) {
      values[field.key] = getFormValue(form, field);
    }

    const isDuplicate =
      editing !== "new" &&
      editing._duplicate === true;

    const isNew =
      editing === "new" ||
      isDuplicate;

    let id: string | undefined;

    if (
      editing === "new" ||
      isDuplicate
    ) {
      id = undefined;
    } else {
      id = itemId(editing);
    }

    try {
      const response = await fetch(`/api/admin/resources/${resource}`, {
        method: isNew ? "POST" : "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id,
          values
        })
      });
      const result = await readListResponse(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível salvar.");
      }

      const successMessage = result.message ?? "Alterações salvas.";
      window.dispatchEvent(new Event("banner-form-saved"));
      setEditing(null);
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível salvar."
      );
    } finally {
      setPending(false);
    }
  };

  const duplicate = (item: Item): void => {
    const copy: Item = {
      ...item,
      _duplicate: true
    };

    delete copy.id;

    for (const key of ["name", "title", "slug", "code", "sku"]) {
      const currentValue = copy[key];
      if (typeof currentValue === "string") {
        copy[key] = `${currentValue}-copia`;
      }
    }

    if (definition.archiveField && definition.restoreValue !== undefined) {
      copy[definition.archiveField] = definition.restoreValue;
    }

    setEditing(copy);
  };

  const updateState = async (): Promise<void> => {
    if (!stateTarget || pending) return;

    const moderationReason = resource === "avaliacoes" && stateTarget.action === "archive"
      ? window.prompt("Informe a justificativa para arquivar esta avaliação:")?.trim()
      : undefined;
    if (resource === "avaliacoes" && stateTarget.action === "archive" && !moderationReason) return;

    setPending(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/resources/${resource}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: stateTarget.action,
          ids: stateTarget.items.map(itemId).filter(Boolean),
          reason: moderationReason
        })
      });
      const result = await readListResponse(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível atualizar os registros.");
      }

      const successMessage = result.message ?? "Registros atualizados.";
      setStateTarget(null);
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível atualizar os registros."
      );
    } finally {
      setPending(false);
    }
  };

  const isArchived = (item: Item): boolean =>
    Boolean(
      definition.archiveField &&
        item[definition.archiveField] === definition.archiveValue
    );

  const selectedItems = items.filter((item) => selectedIds.includes(itemId(item)));
  const selectedArchivedItems = selectedItems.filter(isArchived);
  const selectedActiveItems = selectedItems.filter((item) => !isArchived(item));
  const selectableIds = items.map(itemId).filter(Boolean);
  const allItemsSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  return (
    <section className="panel-card admin-resource">
      <header className="admin-resource-header">
        <div>
          <h1>{definition.label}</h1>
          <p>{definition.description}</p>
        </div>

        {canCreate ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden="true" /> {createLabel}
          </button>
        ) : null}
      </header>

      <div className="admin-toolbar">
        <form
          className="admin-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedQuery(query.trim());
          }}
        >
          <Search aria-hidden="true" />

          <label className="sr-only" htmlFor={`search-${resource}`}>
            Buscar
          </label>

          <input
            id={`search-${resource}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Buscar em ${definition.label.toLocaleLowerCase("pt-BR")}`}
          />

          <button className="secondary-button" type="submit">
            Buscar
          </button>
        </form>

        {statusField ? (
          <select
            aria-label="Filtrar por status"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">Todos os status</option>

            {statusField.type === "boolean" ? (
              <>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
              </>
            ) : (
              statusField.options?.map((option) => (
                <option key={option} value={option}>
                  {statusLabels[option] ?? option}
                </option>
              ))
            )}
          </select>
        ) : null}

        {query || submittedQuery || status ? (
          <button
            className="secondary-button filter-clear-button"
            type="button"
            onClick={() => {
              setQuery("");
              setSubmittedQuery("");
              setStatus("");
              setPage(1);
            }}
          >
            <X aria-hidden="true" /> Limpar filtros
          </button>
        ) : null}

        <button
          className="icon-button"
          type="button"
          onClick={() => void load()}
          aria-label="Atualizar registros"
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : ""} />
        </button>
      </div>

      {canArchive && selectedItems.length > 0 ? (
        <div className="admin-bulk-actions" role="toolbar" aria-label="Ações em massa">
          <strong>{selectedItems.length} selecionado(s)</strong>
          <button
            className="secondary-button"
            type="button"
            disabled={selectedArchivedItems.length === 0}
            onClick={() => setStateTarget({ items: selectedArchivedItems, action: "restore" })}
          >
            <RotateCcw aria-hidden="true" /> Restaurar
          </button>
          <button
            className="secondary-button danger-button"
            type="button"
            disabled={selectedActiveItems.length === 0}
            onClick={() => setStateTarget({ items: selectedActiveItems, action: "archive" })}
          >
            <Archive aria-hidden="true" /> Arquivar
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="admin-feedback" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" /> Carregando
        </div>
      ) : loadError ? (
        <div className="admin-empty-state" role="alert">
          <h3>Não foi possível carregar os registros</h3>
          <p>{loadError}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="admin-empty-state">
          <h3>Nenhum registro encontrado</h3>
          <p>{canCreate ? `Cadastre ${definition.singular} para começar nesta área.` : "Não há dados reais para os filtros informados."}</p>
          {canCreate ? (
            <button className="primary-button" type="button" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" /> {createLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="data-table admin-data-table">
              <thead>
                <tr>
                  {canArchive ? (
                    <th className="admin-select-cell">
                      <input
                        type="checkbox"
                        checked={allItemsSelected}
                        onChange={(event) =>
                          setSelectedIds(event.target.checked ? selectableIds : [])
                        }
                        aria-label="Selecionar registros desta página"
                      />
                    </th>
                  ) : null}
                  {columns.map((column) => (
                    <th key={column}>{columnLabel(column, definition.fields)}</th>
                  ))}
                  {definition.fields.length > 0 && (canUpdate || canCreate || canArchive) ? (
                    <th>Ações</th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {items.map((item, index) => (
                  <tr key={itemId(item) || `item-${index}`}>
                    {canArchive ? (
                      <td className="admin-select-cell" data-label="Selecionar">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(itemId(item))}
                          onChange={(event) => {
                            const id = itemId(item);
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, id])]
                                : current.filter((selected) => selected !== id)
                            );
                          }}
                          aria-label={`Selecionar ${displayValue(
                            item[selectionLabelColumn],
                            selectionLabelColumn
                          )}`}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td key={column} data-label={columnLabel(column, definition.fields)}>
                        {displayValue(item[column], column)}
                      </td>
                    ))}

                    {definition.fields.length > 0 && (canUpdate || canCreate || canArchive) ? (
                      <td className="admin-row-actions">
                        {canUpdate ? (
                          <button
                            type="button"
                            onClick={() => setEditing(item)}
                            aria-label="Editar"
                          >
                            <Pencil />
                          </button>
                        ) : null}

                        {canCreate ? (
                          <button
                            type="button"
                            onClick={() => duplicate(item)}
                            aria-label="Duplicar"
                          >
                            <Copy />
                          </button>
                        ) : null}

                        {canArchive && isArchived(item) ? (
                          <button
                            type="button"
                            onClick={() => setStateTarget({ items: [item], action: "restore" })}
                            aria-label="Restaurar"
                          >
                            <RotateCcw />
                          </button>
                        ) : canArchive ? (
                          <button
                            type="button"
                            onClick={() => setStateTarget({ items: [item], action: "archive" })}
                            aria-label="Arquivar"
                          >
                            <Archive />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="admin-pagination">
            <span>{total.toLocaleString("pt-BR")} registros</span>

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
        </>
      )}

      {editing ? (
        <div className="admin-modal-backdrop">
          <section
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-form-title"
          >
            <header>
              <div>
                <span>{editing === "new" ? "Novo registro" : "Editar registro"}</span>
                <h2 id="resource-form-title">{definition.singular}</h2>
              </div>

              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Fechar"
              >
                <X />
              </button>
            </header>

            <form onSubmit={(event) => void save(event)}>
              <div className="admin-form-grid">
                {definition.fields.map((field) => {
                  const source: Item = editing === "new" ? {} : editing;
                  const value = fieldValue(source, field);

                  if (resource === "banners" && (field.key === "image_path_desktop" || field.key === "image_path_mobile")) {
                    return <BannerImageField field={field} initialPath={formValue(value)} key={field.key} />;
                  }

                  if (resource === "banners" && field.key === "destination_type") {
                    return <BannerDestinationField source={source} key={field.key} />;
                  }

                  if (resource === "banners" && ["destination_id", "destination_url"].includes(field.key)) {
                    return null;
                  }

                  return (
                    <label
                      className={
                        field.type === "textarea" || field.type === "json" ? "wide" : ""
                      }
                      key={field.key}
                    >
                      <span>
                        {field.label}
                        {field.required ? " *" : ""}
                      </span>

                      {field.type === "boolean" ? (
                        <input
                          name={field.key}
                          type="checkbox"
                          defaultChecked={value === true}
                        />
                      ) : field.type === "select" ? (
                        <select
                          name={field.key}
                          defaultValue={formValue(value)}
                          required={field.required}
                        >
                          <option value="">Selecione</option>
                          {field.options?.map((option) => (
                            <option key={option} value={option}>
                              {statusLabels[option] ?? option}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "textarea" || field.type === "json" ? (
                        <textarea
                          name={field.key}
                          defaultValue={formValue(value)}
                          required={field.required}
                          rows={field.type === "json" ? 6 : 4}
                        />
                      ) : (
                        <input
                          name={field.key}
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "datetime"
                                ? "datetime-local"
                                : "text"
                          }
                          defaultValue={formValue(value)}
                          required={field.required}
                          step={field.type === "number" ? "any" : undefined}
                        />
                      )}
                    </label>
                  );
                })}
              </div>

              <footer>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={pending}
                >
                  Cancelar
                </button>

                <button className="primary-button" type="submit" disabled={pending}>
                  {pending ? <LoaderCircle className="spin" /> : null}
                  Salvar
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {stateTarget ? (
        <div className="admin-modal-backdrop">
          <section
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="state-action-title"
          >
            <h2 id="state-action-title">
              {stateTarget.action === "archive" ? "Arquivar" : "Restaurar"}{" "}
              {stateTarget.items.length === 1 ? "registro?" : "registros?"}
            </h2>
            <p>
              {stateTarget.action === "archive"
                ? "Os itens deixarão de ficar ativos, mas o histórico será preservado."
                : "Os itens voltarão como rascunho ou ativos, conforme o tipo de cadastro."}
            </p>

            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStateTarget(null)}
                disabled={pending}
              >
                Cancelar
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={() => void updateState()}
                disabled={pending}
              >
                {pending ? <LoaderCircle className="spin" /> : null}
                {stateTarget.action === "archive" ? "Arquivar" : "Restaurar"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function createActionLabel(resource: AdminResourceKey, singular: string) {
  const labels: Partial<Record<AdminResourceKey, string>> = {
    categorias: "Nova categoria",
    modelos: "Novo modelo",
    colecoes: "Nova coleção",
    variacoes: "Nova variação",
    midias: "Nova mídia",
    banners: "Novo banner",
    conteudo: "Novo conteúdo",
    marketing: "Novo público",
    cupons: "Criar cupom",
    kits: "Novo kit",
    niveis: "Novo nível",
    metas: "Nova meta",
    comissoes: "Nova regra",
    campanhas: "Nova campanha",
    treinamentos: "Novo treinamento"
  };
  return labels[resource] ?? `Adicionar ${singular}`;
}

type BannerTarget = { id: string; label: string; detail: string; route: string };

const destinationLabels: Record<string, string> = {
  none: "Nenhum destino",
  product: "Produto",
  category: "Categoria",
  collection: "Coleção",
  institutional_page: "Página institucional",
  guide: "Guia",
  campaign: "Campanha",
  internal_page: "Página interna",
  predefined_search: "Busca predefinida",
  external_url: "URL externa autorizada"
};

function bannerPublicUrl(path: string) {
  return publicCatalogMediaUrl(path, {
    storeUrl: process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
  });
}

function BannerImageField({ field, initialPath }: { field: AdminResourceField; initialPath: string }) {
  const device = field.key === "image_path_mobile" ? "mobile" : "desktop";
  const [path, setPath] = useState(initialPath);
  const [preview, setPreview] = useState(() => bannerPublicUrl(initialPath));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const uploadedPath = useRef("");
  const persisted = useRef(false);

  useEffect(() => {
    const markPersisted = () => { persisted.current = true; };
    window.addEventListener("banner-form-saved", markPersisted);
    return () => {
      window.removeEventListener("banner-form-saved", markPersisted);
      if (uploadedPath.current && !persisted.current) {
        void fetch("/api/admin/banner-media", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: uploadedPath.current }),
          keepalive: true
        });
      }
    };
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("device", device);
      const response = await fetch("/api/admin/banner-media", { method: "POST", body: form });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload) || typeof payload.path !== "string") {
        throw new Error(isRecord(payload) && typeof payload.message === "string" ? payload.message : "Upload indisponível.");
      }
      if (uploadedPath.current) {
        void fetch("/api/admin/banner-media", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: uploadedPath.current })
        });
      }
      uploadedPath.current = payload.path;
      setPath(payload.path);
      setPreview(typeof payload.publicUrl === "string" ? payload.publicUrl : bannerPublicUrl(payload.path));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="banner-image-field">
      <span>{field.label}{field.required ? " *" : ""}</span>
      <input name={field.key} type="hidden" value={path} />
      {preview ? <img src={preview} alt={`Prévia da ${field.label.toLocaleLowerCase("pt-BR")}`} /> : <div className="banner-image-placeholder">Nenhuma imagem enviada</div>}
      <label className="secondary-button">
        {uploading ? <LoaderCircle className="spin" /> : <Upload aria-hidden="true" />}
        {uploading ? "Enviando…" : "Selecionar imagem"}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event.target.files?.[0])} disabled={uploading} />
      </label>
      <small>JPG, PNG ou WebP, até 10 MB.</small>
      {error ? <small className="banner-field-error" role="alert">{error}</small> : null}
    </div>
  );
}

function BannerDestinationField({ source }: { source: Item }) {
  const initialType = typeof source.destination_type === "string" ? source.destination_type : "internal_page";
  const [type, setType] = useState(initialType);
  const [targetId, setTargetId] = useState(typeof source.destination_id === "string" ? source.destination_id : "");
  const [url, setUrl] = useState(typeof source.destination_url === "string" ? source.destination_url : "/");
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<BannerTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectable = ["product", "category", "collection", "institutional_page", "guide", "campaign", "internal_page"].includes(type);

  const loadTargets = useCallback(async (search = "") => {
    if (!["product", "category", "collection", "institutional_page", "guide", "campaign", "internal_page"].includes(type)) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/api/admin/banner-targets?${params}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload)) throw new Error("Não foi possível carregar os destinos.");
      setTargets(Array.isArray(payload.targets) ? payload.targets.filter(isRecord).flatMap((item) =>
        typeof item.id === "string" && typeof item.label === "string" && typeof item.route === "string"
          ? [{ id: item.id, label: item.label, detail: typeof item.detail === "string" ? item.detail : "", route: item.route }]
          : []) : []);
    } catch (targetError) {
      setError(targetError instanceof Error ? targetError.message : "Não foi possível carregar os destinos.");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { if (selectable) void loadTargets(); }, [loadTargets, selectable]);

  const chooseType = (nextType: string) => {
    setType(nextType);
    setTargetId("");
    setTargets([]);
    setUrl(nextType === "none" ? "/" : "");
  };

  return (
    <fieldset className="wide banner-destination-field">
      <legend>Destino do banner</legend>
      <input name="destination_type" type="hidden" value={type} />
      <input name="destination_id" type="hidden" value={targetId} />
      <input name="destination_url" type="hidden" value={url} />
      <label>Tipo<select value={type} onChange={(event) => chooseType(event.target.value)}>{Object.entries(destinationLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      {selectable ? (
        <>
          <div className="banner-target-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar destino" /><button className="secondary-button" type="button" onClick={() => void loadTargets(query)} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search />} Buscar</button></div>
          <label>Destino<select value={targetId} onChange={(event) => { const target = targets.find((item) => item.id === event.target.value); setTargetId(target?.id ?? ""); setUrl(target?.route ?? ""); }} required><option value="">Selecione sem digitar links</option>{targets.map((target) => <option value={target.id} key={target.id}>{target.label} · {target.detail}</option>)}</select></label>
        </>
      ) : null}
      {type === "predefined_search" ? <label>Busca<input value={url.startsWith("/busca?q=") ? decodeURIComponent(url.slice(9)) : ""} onChange={(event) => setUrl(event.target.value.trim() ? `/busca?q=${encodeURIComponent(event.target.value.trim())}` : "")} placeholder="Termo de busca" required /></label> : null}
      {type === "external_url" ? <label>URL HTTPS autorizada<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://dominio-autorizado.com/…" required /><small>O domínio precisa constar em Configurações administrativas → banner_external_hosts.</small></label> : null}
      {url && type !== "none" ? <p>Destino gerado: <code>{url}</code></p> : null}
      {error ? <p className="banner-field-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
