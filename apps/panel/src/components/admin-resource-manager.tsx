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
  Search,
  X
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
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
};

function isRecord(value: unknown): value is Item {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseListResponse(value: unknown): ListResponse {
  if (!isRecord(value)) return {};

  return {
    items: Array.isArray(value.items) ? value.items.filter(isRecord) : undefined,
    total: readNumber(value.total),
    page: readNumber(value.page),
    pageSize: readNumber(value.pageSize),
    message: typeof value.message === "string" ? value.message : undefined
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

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value;
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

function itemId(item: Item): string {
  if (typeof item.id === "string") return item.id;
  if (typeof item.key === "string") return item.key;
  return "";
}

function fieldValue(item: Item, field: AdminResourceField): unknown {
  const value = item[field.key];

  if (field.type === "datetime" && typeof value === "string") {
    return value.slice(0, 16);
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
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

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
    } catch {
      setMessage("Não foi possível carregar os registros agora.");
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

      setMessage(result.message ?? "Alterações salvas.");
      setEditing(null);
      await load();
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

    setEditing(copy);
  };

  const archive = async (): Promise<void> => {
    if (!archiveTarget || pending) return;

    setPending(true);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/resources/${resource}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id: itemId(archiveTarget)
        })
      });
      const result = await readListResponse(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível arquivar.");
      }

      setMessage(result.message ?? "Registro arquivado.");
      setArchiveTarget(null);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível arquivar."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel-card admin-resource">
      <header className="admin-resource-header">
        <div>
          <h2>{definition.label}</h2>
          <p>{definition.description}</p>
        </div>

        {definition.allowCreate ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden="true" /> Novo
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
                  {option}
                </option>
              ))
            )}
          </select>
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

      {message ? (
        <p className="admin-feedback" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" /> Carregando
        </div>
      ) : items.length === 0 ? (
        <div className="admin-empty-state">
          <h3>Nenhum registro encontrado</h3>
          <p>Ajuste os filtros ou crie o primeiro registro desta área.</p>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="data-table admin-data-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column.replaceAll("_", " ")}</th>
                  ))}
                  {definition.fields.length > 0 ? <th>Ações</th> : null}
                </tr>
              </thead>

              <tbody>
                {items.map((item, index) => (
                  <tr key={itemId(item) || `item-${index}`}>
                    {columns.map((column) => (
                      <td key={column} data-label={column.replaceAll("_", " ")}>
                        {displayValue(item[column])}
                      </td>
                    ))}

                    {definition.fields.length > 0 ? (
                      <td className="admin-row-actions">
                        <button
                          type="button"
                          onClick={() => setEditing(item)}
                          aria-label="Editar"
                        >
                          <Pencil />
                        </button>

                        {definition.allowCreate ? (
                          <button
                            type="button"
                            onClick={() => duplicate(item)}
                            aria-label="Duplicar"
                          >
                            <Copy />
                          </button>
                        ) : null}

                        {definition.allowArchive ? (
                          <button
                            type="button"
                            onClick={() => setArchiveTarget(item)}
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
                              {option}
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

      {archiveTarget ? (
        <div className="admin-modal-backdrop">
          <section
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="archive-title"
          >
            <h2 id="archive-title">Arquivar registro?</h2>
            <p>O item deixará de ficar ativo, mas o histórico será preservado.</p>

            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setArchiveTarget(null)}
                disabled={pending}
              >
                Cancelar
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={() => void archive()}
                disabled={pending}
              >
                {pending ? <LoaderCircle className="spin" /> : null}
                Arquivar
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}