"use client";

import { formatBRL, formatBRLInput, parseBRLToCents } from "@curtiz/domain";

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
  Trash2,
  X
} from "lucide-react";
import { BannerManager } from "./banner-manager";
import { BlingOperational } from "./bling-operational";
import { categoryDeletionMessage } from "../lib/category-management";
import { usePanelPrompt } from "./panel-prompt";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminResources,
  kitGradePriceFields,
  type AdminResourceField,
  type AdminResourceKey
} from "@/lib/admin-resources";

type Item = Record<string, unknown>;
type KitGradeSource = { productId: string; name: string; color: string };

const kitGradeDistributions: Record<(typeof kitGradePriceFields)[number]["key"], string> = {
  grade_standard_price_cents: "34×1, 35×2, 36×3, 37×3, 38×2, 39×1",
  grade_lower_restock_price_cents: "34×1, 35×3, 36×4, 37×4",
  grade_upper_restock_price_cents: "37×4, 38×4, 39×4"
};

type ListResponse = {
  items?: Item[];
  total?: number;
  page?: number;
  pageSize?: number;
  message?: string;
  capabilities?: ResourceCapabilities;
  errors?: Record<string, string>;
};

type ResourceCapabilities = {
  create: boolean;
  update: boolean;
  archive: boolean;
  delete: boolean;
};

const noCapabilities: ResourceCapabilities = {
  create: false,
  update: false,
  archive: false,
  delete: false
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
        archive: value.capabilities.archive === true,
        delete: value.capabilities.delete === true
      }
    : undefined;

  return {
    items: Array.isArray(value.items) ? value.items.filter(isRecord) : undefined,
    total: readNumber(value.total),
    page: readNumber(value.page),
    pageSize: readNumber(value.pageSize),
    message: typeof value.message === "string" ? value.message : undefined,
    capabilities,
    errors: isRecord(value.errors)
      ? Object.fromEntries(
          Object.entries(value.errors).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined
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
  accepted_at: "Aceito em",
  product_count: "Produtos",
  kit_line: "Linha de estoque",
  kit_prices: "Preços por ficha"
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
  if (typeof value === "number" && Number.isFinite(value)) {
    if (column === "basis_points") {
      return `${(value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
    }
    return column.endsWith("_in_cents") || column.endsWith("_cents")
      ? formatBRL(value)
      : String(value);
  }

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

  if (field.type === "money" && typeof value === "number" && Number.isFinite(value)) {
    return formatBRLInput(value);
  }

  if (field.type === "percentage" && typeof value === "number" && Number.isFinite(value)) {
    return String(value / 100).replace(".", ",");
  }

  if (field.type === "datetime" && typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : dateTimeInput.format(parsed).replace(" ", "T");
  }

  if (field.type === "json" && value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return value ?? "";
}

function formValue(value: unknown): string {
  return scalarToString(value);
}

const resourceSlug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

function numberInputMode(field: AdminResourceField): "numeric" | "decimal" {
  return /(price|amount|value|cost|percent|discount|height|width|length)/iu.test(field.key)
    ? "decimal"
    : "numeric";
}

function getFormValue(form: FormData, field: AdminResourceField): unknown {
  if (field.type === "boolean") {
    return form.get(field.key) === "on";
  }

  const value = form.get(field.key);
  if (field.type === "money" && typeof value === "string") {
    return value.trim() ? parseBRLToCents(value) : "";
  }
  if (field.type === "percentage" && typeof value === "string") {
    if (!value.trim()) return "";
    const percentage = Number(value.replace(",", "."));
    return Number.isFinite(percentage) ? Math.round(percentage * 100) : value;
  }
  return typeof value === "string" ? value : "";
}

export function AdminResourceManager({ resource }: { resource: AdminResourceKey }) {
  return resource === "banners" ? <BannerManager /> : <GenericResourceManager resource={resource} />;
}

function GenericResourceManager({ resource }: { resource: AdminResourceKey }) {
  const requestPrompt = usePanelPrompt();
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
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] = useState<ResourceCapabilities>(noCapabilities);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [stateError, setStateError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [categorySlugEdited, setCategorySlugEdited] = useState(false);
  const [kitGradeSource, setKitGradeSource] = useState("");
  const [kitGradeSources, setKitGradeSources] = useState<KitGradeSource[] | null>(null);
  const [kitGradeSourcesError, setKitGradeSourcesError] = useState(false);
  const [kitGradeSourcesRetry, setKitGradeSourcesRetry] = useState(0);
  const [kitLineNames, setKitLineNames] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stateTarget, setStateTarget] = useState<{
    items: Item[];
    action: "archive" | "restore";
  } | null>(null);

  useEffect(() => {
    if (resource !== "categorias" || !editing) return;
    const source = editing === "new" ? {} : editing;
    setCategoryName(formValue(source.name));
    setCategorySlug(formValue(source.slug));
    setCategorySlugEdited(editing !== "new" && Boolean(formValue(source.slug)));
    setFieldErrors({});
  }, [editing, resource]);

  useEffect(() => {
    if (resource !== "kits" || !capabilities.update) return;
    const controller = new AbortController();
    void fetch("/api/admin/resources/kits?gradeSources=true", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await readListResponse(response);
        if (!response.ok || !result.items) return;
        const names: Record<string, string> = {};
        for (const item of result.items) {
          if (typeof item.productId === "string" && typeof item.name === "string") names[item.productId] = item.name;
        }
        if (!controller.signal.aborted) setKitLineNames(names);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [capabilities.update, resource]);

  useEffect(() => {
    if (resource !== "kits" || !editing) return;
    const controller = new AbortController();
    setFieldErrors({});
    setKitGradeSources(null);
    setKitGradeSourcesError(false);
    void fetch("/api/admin/resources/kits?gradeSources=true", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await readListResponse(response);
        if (!response.ok || !result.items) throw new Error("Linhas de estoque indisponíveis.");
        const sources = result.items.flatMap(item =>
          typeof item.productId === "string" && typeof item.name === "string" && typeof item.color === "string"
            ? [{ productId: item.productId, name: item.name, color: item.color }]
            : []);
        if (!controller.signal.aborted) setKitGradeSources(sources);
      })
      .catch(() => {
        if (!controller.signal.aborted) setKitGradeSourcesError(true);
      });
    return () => controller.abort();
  }, [editing, kitGradeSourcesRetry, resource]);

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

    if (resource === "kits") return ["name", "kit_line", "kit_prices", "active"];
    return resource === "categorias"
      ? ["name", "product_count", "active", "sort_order"]
      : keys.slice(0, 5);
  }, [definition.select, resource]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selectionLabelColumn = columns[0] ?? "id";
  const canCreate = definition.allowCreate && capabilities.create;
  const canUpdate = definition.allowCreate && capabilities.update;
  const canArchive = definition.allowArchive && capabilities.archive;
  const canDelete = definition.allowDelete === true && capabilities.delete;

  const openEditor = (item: Item | "new") => {
    if (resource === "kits") {
      setKitGradeSource(item !== "new" && typeof item.grade_product_id === "string" && typeof item.grade_color === "string"
        ? `${item.grade_product_id}|${item.grade_color}`
        : "");
    }
    setFieldErrors({});
    setFormError("");
    setEditing(item);
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending || !editing) return;

    setPending(true);
    setMessage(null);
    setFormError("");
    setDeleteError("");
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};

    try {
      for (const field of definition.fields) {
        if (resource === "kits" && field.key === "price_in_cents" && kitGradeSource) continue;
        values[field.key] = getFormValue(form, field);
      }
      if (resource === "categorias") {
        values.name = categoryName;
        values.slug = categorySlug || resourceSlug(categoryName);
      }
      if (resource === "kits") {
        values.gradeSource = kitGradeSource;
        if (kitGradeSource) {
          for (const field of kitGradePriceFields) values[field.key] = getFormValue(form, field);
        }
      }
    } catch (error) {
      setFormError(error instanceof Error && error.message ? error.message : "Revise os valores informados.");
      setPending(false);
      return;
    }

    const isDuplicate = editing !== "new" && editing._duplicate === true;

    const isNew = editing === "new" || isDuplicate;

    let id: string | undefined;

    if (editing === "new" || isDuplicate) {
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
        setFieldErrors(result.errors ?? {});
        throw new Error(result.message || "Não foi possível salvar.");
      }

      const successMessage = result.message ?? "Alterações salvas.";

      setEditing(null);
      await load();
      setMessage({ kind: "success", text: successMessage });
    } catch (error) {
      setFormError(error instanceof Error && error.message ? error.message : "Não foi possível salvar.");
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
        copy[key] = resource === "kits" && key === "name" ? `${currentValue} (cópia)` : `${currentValue}-copia`;
      }
    }

    if (definition.archiveField && definition.restoreValue !== undefined) {
      copy[definition.archiveField] = definition.restoreValue;
    }

    openEditor(copy);
  };

  const updateState = async (): Promise<void> => {
    if (!stateTarget || pending) return;

    const moderationReason =
      resource === "avaliacoes" && stateTarget.action === "archive"
        ? await requestPrompt({
            title: "Arquivar avaliação",
            label: "Justificativa da moderação",
            minLength: 3,
            confirmLabel: "Continuar"
          })
        : undefined;
    if (resource === "avaliacoes" && stateTarget.action === "archive" && !moderationReason) return;

    setPending(true);
    setMessage(null);
    setStateError("");

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
      setMessage({ kind: "success", text: successMessage });
    } catch (error) {
      setStateError(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível atualizar os registros."
      );
    } finally {
      setPending(false);
    }
  };

  const deletionDependency = (target: Item) => resource === "categorias"
    ? categoryDeletionMessage(Number(target.product_count) || 0, Number(target.subcategory_count) || 0)
    : null;

  const deleteResource = async (): Promise<void> => {
    if (!canDelete || !deleteTarget || pending) return;
    const dependencyMessage = deletionDependency(deleteTarget);
    if (dependencyMessage) { setDeleteError(dependencyMessage); return; }
    const failureMessage = resource === "kits" ? "Não foi possível excluir o kit." : "Não foi possível excluir a categoria.";
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/resources/${resource}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: itemId(deleteTarget), permanent: true })
      });
      const result = await readListResponse(response);
      if (!response.ok) throw new Error(result.message || failureMessage);
      setDeleteTarget(null);
      await load();
      setMessage({ kind: "success", text: result.message ?? "Registro excluído." });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : failureMessage);
    } finally {
      setPending(false);
    }
  };

  const isArchived = (item: Item): boolean =>
    Boolean(definition.archiveField && item[definition.archiveField] === definition.archiveValue);

  const selectedItems = items.filter((item) => selectedIds.includes(itemId(item)));
  const selectedArchivedItems = selectedItems.filter(isArchived);
  const selectedActiveItems = selectedItems.filter((item) => !isArchived(item));
  const selectableIds = items.map(itemId).filter(Boolean);
  const allItemsSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  return (
    <section className="panel-card admin-resource">
      {resource === "pedidos" ? <BlingOperational /> : null}
      <header className="admin-resource-header">
        <div>
          <h1>{definition.label}</h1>
          <p>{definition.description}</p>
        </div>

        {canCreate ? (
          <button className="primary-button" type="button" onClick={() => openEditor("new")}>
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
        <p className={`admin-feedback ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
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
          <h3>{resource === "kits" && !submittedQuery && !status ? "Nenhum kit cadastrado." : "Nenhum registro encontrado"}</h3>
          <p>
            {canCreate
              ? resource === "kits"
                ? "Cadastre um kit e vincule uma linha de estoque para ele aparecer ao representante."
                : `Cadastre ${definition.singular} para começar nesta área.`
              : "Não há dados reais para os filtros informados."}
          </p>
          {canCreate ? (
            <button className="primary-button" type="button" onClick={() => openEditor("new")}>
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
                        {column === "kit_line" ? (
                          typeof item.grade_product_id === "string" && typeof item.grade_color === "string" ? (
                            <div className="kit-admin-line">
                              <strong>{kitLineNames[item.grade_product_id] ?? "Linha vinculada"}</strong>
                              <small>{item.grade_color}</small>
                            </div>
                          ) : (
                            <span className="kit-admin-line-missing">Sem linha de estoque — não aparece ao representante</span>
                          )
                        ) : column === "kit_prices" ? (
                          item.grade_product_id
                            ? (
                              <div className="kit-admin-prices">
                                {kitGradePriceFields.map(field => (
                                  <div key={field.key}>
                                    <span>{field.label}</span>
                                    <strong>{displayValue(item[field.key] ?? item.price_in_cents, field.key)}</strong>
                                  </div>
                                ))}
                              </div>
                            )
                            : displayValue(item.price_in_cents, "price_in_cents")
                        ) : displayValue(item[column], column)}
                      </td>
                    ))}

                    {definition.fields.length > 0 && (canUpdate || canCreate || canArchive) ? (
                      <td className="admin-row-actions">
                        {canUpdate ? (
                          <button
                            type="button"
                            onClick={() => openEditor(item)}
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
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(deletionDependency(item) ?? "");
                              setDeleteTarget(item);
                            }}
                            aria-label={resource === "kits" ? `Excluir kit ${displayValue(item.name, "name")}` : "Excluir permanentemente"}
                          >
                            <Trash2 />
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
              {resource === "kits" ? (
                <h2 id="resource-form-title">{editing === "new" || editing._duplicate ? "Novo kit" : "Editar kit"}</h2>
              ) : (
                <div>
                  <span>{editing === "new" ? "Novo registro" : "Editar registro"}</span>
                  <h2 id="resource-form-title">{definition.singular}</h2>
                </div>
              )}

              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar">
                <X />
              </button>
            </header>

            <form onSubmit={(event) => void save(event)}>
              <div className="admin-form-grid">
                {definition.fields.map((field) => {
                  if (resource === "kits" && field.key === "price_in_cents" && kitGradeSource) return null;
                  const source: Item = editing === "new" ? {} : editing;
                  const value = fieldValue(source, field);

                  if (resource === "categorias" && ["name", "slug"].includes(field.key)) {
                    const isName = field.key === "name";
                    return (
                      <label key={field.key}>
                        <span>{field.label}{isName ? " *" : ""}</span>
                        <input
                          name={field.key}
                          required={isName}
                          value={isName ? categoryName : categorySlug}
                          placeholder={isName ? "Ex.: Sandálias" : "Gerado automaticamente"}
                          onChange={(event) => {
                            if (isName) {
                              setCategoryName(event.target.value);
                              if (!categorySlugEdited) setCategorySlug(resourceSlug(event.target.value));
                            } else {
                              setCategorySlug(resourceSlug(event.target.value));
                              setCategorySlugEdited(Boolean(event.target.value));
                            }
                            setFieldErrors((current) => ({ ...current, [field.key]: "" }));
                          }}
                          aria-invalid={Boolean(fieldErrors[field.key])}
                          aria-describedby={fieldErrors[field.key] ? `${field.key}-error` : undefined}
                        />
                        {fieldErrors[field.key] ? (
                          <small className="admin-field-error" id={`${field.key}-error`} role="alert">
                            {fieldErrors[field.key]}
                          </small>
                        ) : null}
                      </label>
                    );
                  }

                  return (
                    <label
                      className={field.type === "textarea" || field.type === "json" || (resource === "kits" && field.key === "name") ? "wide" : ""}
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
                          defaultChecked={value === true || (editing === "new" && resource === "categorias")}
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
                      ) : field.type === "money" ? (
                        <span className="money-field-control">
                          <span aria-hidden="true">R$</span>
                          <input
                            name={field.key}
                            type="text"
                            inputMode="decimal"
                            defaultValue={formValue(value)}
                            required={field.required}
                            placeholder="0,00"
                          />
                        </span>
                      ) : field.type === "percentage" ? (
                        <span className="percentage-field-control">
                          <input
                            name={field.key}
                            type="text"
                            inputMode="decimal"
                            defaultValue={formValue(value)}
                            required={field.required}
                            placeholder="0"
                            aria-describedby={`${field.key}-suffix`}
                          />
                          <span id={`${field.key}-suffix`} aria-hidden="true">%</span>
                        </span>
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
                          inputMode={field.type === "number" ? numberInputMode(field) : undefined}
                          aria-invalid={Boolean(fieldErrors[field.key])}
                          aria-describedby={fieldErrors[field.key] ? `${field.key}-error` : undefined}
                        />
                      )}
                      {fieldErrors[field.key] && (
                        <small className="admin-field-error" id={`${field.key}-error`} role="alert">{fieldErrors[field.key]}</small>
                      )}
                    </label>
                  );
                })}
                {resource === "kits" && (
                  <div className="wide">
                    <label>
                      <span>Linha de estoque das fichas</span>
                      {kitGradeSources ? (
                        <select
                          name="gradeSource"
                          value={kitGradeSource}
                          onChange={event => setKitGradeSource(event.target.value)}
                          aria-describedby={fieldErrors.gradeSource ? "grade-source-error" : "grade-source-help"}
                          aria-invalid={Boolean(fieldErrors.gradeSource)}
                        >
                          <option value="">Sem fichas vinculadas</option>
                          {editing !== "new" && typeof editing.grade_product_id === "string" && typeof editing.grade_color === "string"
                            && !kitGradeSources.some(source => source.productId === editing.grade_product_id && source.color === editing.grade_color) && (
                              <option value={`${editing.grade_product_id}|${editing.grade_color}`}>Linha vinculada indisponível</option>
                            )}
                          {kitGradeSources.map(source => {
                            const value = `${source.productId}|${source.color}`;
                            return <option key={value} value={value}>{source.name} · {source.color}</option>;
                          })}
                        </select>
                      ) : kitGradeSourcesError ? (
                        <span role="alert">Não foi possível carregar as linhas de estoque.</span>
                      ) : <span role="status">Carregando linhas de estoque…</span>}
                    </label>
                    {kitGradeSourcesError && <button type="button" className="secondary-button" onClick={() => setKitGradeSourcesRetry(value => value + 1)}>Tentar novamente</button>}
                    {fieldErrors.gradeSource ? (
                      <small className="admin-field-error" id="grade-source-error" role="alert">{fieldErrors.gradeSource}</small>
                    ) : (
                      <small id="grade-source-help">Obrigatória para o kit aparecer ao representante. Uma linha de pares avulsos habilita as três fichas de 12 pares.</small>
                    )}
                  </div>
                )}
                {resource === "kits" && kitGradeSource && (
                  <fieldset className="wide kit-grade-prices">
                    <legend>Preços por ficha</legend>
                    <p className="wide kit-grade-help">Cada ficha tem 12 pares, com a distribuição de tamanhos fixa abaixo.</p>
                    {kitGradePriceFields.map(field => {
                      const cents = editing === "new" ? undefined : readNumber(editing[field.key])
                        ?? (editing.grade_product_id ? readNumber(editing.price_in_cents) : undefined);
                      const error = fieldErrors[field.key];
                      return (
                        <label key={field.key}>
                          <span>{field.label} *</span>
                          <small className="kit-grade-sizes">{kitGradeDistributions[field.key]}</small>
                          <span className="money-field-control">
                            <span aria-hidden="true">R$</span>
                            <input
                              name={field.key}
                              type="text"
                              inputMode="decimal"
                              defaultValue={cents === undefined ? "" : formatBRLInput(cents)}
                              placeholder="0,00"
                              required
                              aria-invalid={Boolean(error)}
                              aria-describedby={error ? `${field.key}-error` : undefined}
                            />
                          </span>
                          {error && <small className="admin-field-error" id={`${field.key}-error`} role="alert">{error}</small>}
                        </label>
                      );
                    })}
                  </fieldset>
                )}
              </div>

              {formError ? <p className="admin-modal-error" role="alert">{formError}</p> : null}

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
                  {pending ? "Salvando…" : "Salvar"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="admin-modal-backdrop">
          <section
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-resource-title"
          >
            <h2 id="delete-resource-title">{resource === "kits" ? "Excluir kit?" : "Excluir categoria?"}</h2>
            {resource === "kits" ? (
              <>
                <p>Tem certeza de que deseja excluir o kit <strong>{displayValue(deleteTarget.name, "name")}</strong>?</p>
                <p>O kit sai do catálogo de representantes. Pedidos anteriores ficam no histórico.</p>
                {deleteTarget.required_for_activation === true && <p>Este kit está marcado como obrigatório para ativação.</p>}
              </>
            ) : (
              <p><strong>{displayValue(deleteTarget.name, "name")}</strong> será excluída somente se não estiver em uso.</p>
            )}
            {deleteError ? <p className="admin-field-error" role="alert">{deleteError}</p> : null}
            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                disabled={pending}
              >
                Cancelar
              </button>
              <button
                className="primary-button danger-button"
                type="button"
                onClick={() => void deleteResource()}
                disabled={pending || Boolean(deletionDependency(deleteTarget))}
              >
                {pending ? <LoaderCircle className="spin" /> : null}
                {resource === "kits" ? "Excluir kit" : "Excluir categoria"}
              </button>
            </div>
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
            {stateError ? <p className="admin-modal-error" role="alert">{stateError}</p> : null}

            <div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => { setStateTarget(null); setStateError(""); }}
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
