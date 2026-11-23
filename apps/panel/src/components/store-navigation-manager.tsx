"use client";

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type DestinationType = "category" | "collection" | "page" | "internal_url";
type NavigationItem = {
  id: string;
  label: string;
  placement: "main" | "utility";
  destination_type: DestinationType;
  destination_value: string;
  visible: boolean;
  sort_order: number;
};
type Target = { id: string; name: string; slug: string; active: boolean };
type NavigationResponse = {
  items?: NavigationItem[];
  categories?: Target[];
  collections?: Target[];
  message?: string;
  errors?: Record<string, string>;
};
type MutationResult = { ok: boolean; message: string; errors: Record<string, string> };
type Draft = Omit<NavigationItem, "id" | "sort_order"> & { id?: string };

const emptyDraft: Draft = {
  label: "",
  placement: "main",
  destination_type: "category",
  destination_value: "",
  visible: true
};
const pages = [
  ["Início", "/"],
  ["Todos os produtos", "/produtos"],
  ["Atendimento", "/ajuda"],
  ["Rastrear pedido", "/rastrear-pedido"],
  ["Favoritos", "/favoritos"]
] as const;

export function StoreNavigationManager() {
  const [items, setItems] = useState<NavigationItem[]>([]);
  const [categories, setCategories] = useState<Target[]>([]);
  const [collections, setCollections] = useState<Target[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NavigationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/store-navigation", { cache: "no-store" });
      const result = (await response.json()) as NavigationResponse;
      if (!response.ok) throw new Error(result.message);
      setItems(Array.isArray(result.items) ? result.items : []);
      setCategories(Array.isArray(result.categories) ? result.categories : []);
      setCollections(Array.isArray(result.collections) ? result.collections : []);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Não foi possível carregar o menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (message?.kind !== "success") return undefined;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const mutate = async (body: Record<string, unknown>, key: string): Promise<MutationResult> => {
    if (pending) return { ok: false, message: "", errors: {} };
    setPending(key);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/store-navigation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json().catch(() => ({}))) as NavigationResponse;
      if (!response.ok) {
        return {
          ok: false,
          message: result.message || "Não foi possível concluir a alteração.",
          errors: result.errors ?? {}
        };
      }
      await load();
      return { ok: true, message: result.message ?? "Navegação atualizada.", errors: {} };
    } catch {
      return { ok: false, message: "Falha de conexão. Verifique a internet e tente novamente.", errors: {} };
    } finally {
      setPending("");
    }
  };

  // Ações da própria página (ordem, visibilidade): o resultado aparece na página.
  const mutatePage = async (body: Record<string, unknown>, key: string) => {
    const result = await mutate(body, key);
    if (result.message) setMessage({ kind: result.ok ? "success" : "error", text: result.message });
  };

  const openDraft = (next: Draft | null) => {
    setFormError("");
    setFieldErrors({});
    setDraft(next);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || pending) return;
    setFormError("");
    const localErrors: Record<string, string> = {};
    if (!draft.label.trim()) localErrors.label = "Informe o nome do item.";
    if (!draft.destination_value.trim()) {
      localErrors.destinationValue = draft.destination_type === "internal_url"
        ? "Informe a URL interna."
        : "Escolha um destino.";
    } else if (draft.destination_type === "internal_url" && !/^\/(?!\/)/.test(draft.destination_value.trim())) {
      localErrors.destinationValue = "Informe somente uma URL interna iniciada por /.";
    }
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length) return;
    const result = await mutate({
      action: "save",
      ...(draft.id ? { id: draft.id } : {}),
      label: draft.label,
      placement: draft.placement,
      destinationType: draft.destination_type,
      destinationValue: draft.destination_value,
      visible: draft.visible
    }, draft.id ?? "new");
    if (result.ok) {
      setDraft(null);
      setMessage({ kind: "success", text: result.message });
      return;
    }
    setFieldErrors(result.errors);
    setFormError(result.message);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError("");
    const result = await mutate({ action: "delete", id: deleteTarget.id }, `delete-${deleteTarget.id}`);
    if (result.ok) {
      setDeleteTarget(null);
      setMessage({ kind: "success", text: result.message });
    } else {
      setDeleteError(result.message);
    }
  };

  const move = async (item: NavigationItem, direction: -1 | 1) => {
    const group = items.filter((candidate) => candidate.placement === item.placement);
    const index = group.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= group.length) return;
    const ordered = [...group];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await mutatePage({ action: "reorder", ids: ordered.map((candidate) => candidate.id) }, `move-${item.id}`);
  };

  const edit = (item: NavigationItem) => openDraft({
    id: item.id,
    label: item.label,
    placement: item.placement,
    destination_type: item.destination_type,
    destination_value: item.destination_value,
    visible: item.visible
  });

  return (
    <section className="panel-card store-navigation-manager">
      <header className="admin-resource-header">
        <div><h1>Navegação da loja</h1><p>Controle os links exibidos no cabeçalho da loja.</p></div>
        <button className="primary-button" type="button" onClick={() => openDraft(emptyDraft)}>
          <Plus /> Adicionar item
        </button>
      </header>
      {message ? <p className={`admin-feedback ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
      {loading ? (
        <div className="admin-loading" role="status"><LoaderCircle className="spin" /> Carregando</div>
      ) : error ? (
        <div className="admin-empty-state" role="alert">
          <h3>Não foi possível carregar a navegação</h3><p>{error}</p>
          <button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw /> Tentar novamente</button>
        </div>
      ) : (
        <div className="store-navigation-list">
          {(["main", "utility"] as const).map((placement) => {
            const group = items.filter((item) => item.placement === placement);
            return (
              <section key={placement}>
                <h2>{placement === "main" ? "Menu principal" : "Links utilitários"}</h2>
                {group.length ? group.map((item, index) => (
                  <article key={item.id}>
                    <div className="store-navigation-order">
                      <button type="button" aria-label={`Mover ${item.label} para cima`} disabled={Boolean(pending) || index === 0} onClick={() => void move(item, -1)}><ArrowUp /></button>
                      <button type="button" aria-label={`Mover ${item.label} para baixo`} disabled={Boolean(pending) || index === group.length - 1} onClick={() => void move(item, 1)}><ArrowDown /></button>
                    </div>
                    <div><strong>{item.label}</strong><span>{destinationLabel(item, categories, collections)}</span></div>
                    <span className={`status ${item.visible ? "active" : ""}`}>{item.visible ? "Visível" : "Oculto"}</span>
                    <div className="store-navigation-actions">
                      <button type="button" aria-label={item.visible ? `Ocultar ${item.label}` : `Mostrar ${item.label}`} disabled={Boolean(pending)} onClick={() => void mutatePage({ action: "toggle", id: item.id, visible: !item.visible }, `toggle-${item.id}`)}>{item.visible ? <EyeOff /> : <Eye />}</button>
                      <button type="button" aria-label={`Editar ${item.label}`} disabled={Boolean(pending)} onClick={() => edit(item)}><Pencil /></button>
                      <button type="button" aria-label={`Excluir ${item.label}`} disabled={Boolean(pending)} onClick={() => { setDeleteError(""); setDeleteTarget(item); }}><Trash2 /></button>
                    </div>
                  </article>
                )) : <p>Nenhum item configurado nesta área.</p>}
              </section>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="admin-modal-backdrop">
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="navigation-form-title">
            <header><div><span>Navegação da loja</span><h2 id="navigation-form-title">{draft.id ? "Editar item" : "Adicionar item"}</h2></div><button type="button" onClick={() => openDraft(null)} aria-label="Fechar" disabled={Boolean(pending)}><X /></button></header>
            <form onSubmit={(event) => void save(event)} noValidate>
              <div className="admin-form-grid">
                <label><span>Nome *</span><input autoFocus required maxLength={60} value={draft.label} aria-invalid={Boolean(fieldErrors.label)} aria-describedby={fieldErrors.label ? "navigation-label-error" : undefined} onChange={(event) => { setFieldErrors((current) => ({ ...current, label: "" })); setDraft({ ...draft, label: event.target.value }); }} />{fieldErrors.label ? <small className="admin-field-error" id="navigation-label-error" role="alert">{fieldErrors.label}</small> : null}</label>
                <label><span>Local</span><select value={draft.placement} onChange={(event) => setDraft({ ...draft, placement: event.target.value as Draft["placement"] })}><option value="main">Menu principal</option><option value="utility">Links utilitários</option></select></label>
                <label><span>Destino</span><select value={draft.destination_type} onChange={(event) => { setFieldErrors((current) => ({ ...current, destinationValue: "" })); setDraft({ ...draft, destination_type: event.target.value as DestinationType, destination_value: "" }); }}><option value="category">Categoria</option><option value="collection">Coleção</option><option value="page">Página</option><option value="internal_url">URL interna</option></select></label>
                <DestinationField draft={draft} categories={categories} collections={collections} error={fieldErrors.destinationValue} onChange={(destination_value) => { setFieldErrors((current) => ({ ...current, destinationValue: "" })); setDraft({ ...draft, destination_value }); }} />
                <label className="admin-checkbox"><input type="checkbox" checked={draft.visible} onChange={(event) => setDraft({ ...draft, visible: event.target.checked })} /><span>Exibir na loja</span></label>
              </div>
              {formError ? <p className="admin-modal-error" role="alert">{formError}</p> : null}
              <footer><button className="secondary-button" type="button" onClick={() => openDraft(null)} disabled={Boolean(pending)}>Cancelar</button><button className="primary-button" type="submit" disabled={Boolean(pending)}>{pending ? <LoaderCircle className="spin" /> : null} {pending ? "Salvando…" : "Salvar"}</button></footer>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="admin-modal-backdrop"><section className="admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-navigation-title"><h2 id="delete-navigation-title">Excluir item?</h2><p><strong>{deleteTarget.label}</strong> deixará de fazer parte do menu.</p>{deleteError ? <p className="admin-modal-error" role="alert">{deleteError}</p> : null}<div><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} disabled={Boolean(pending)}>Cancelar</button><button className="primary-button danger-button" type="button" disabled={Boolean(pending)} onClick={() => void confirmDelete()}>{pending ? "Excluindo…" : "Excluir item"}</button></div></section></div>
      ) : null}
    </section>
  );
}

function DestinationField({ draft, categories, collections, error, onChange }: { draft: Draft; categories: Target[]; collections: Target[]; error?: string; onChange: (value: string) => void }) {
  if (draft.destination_type === "internal_url") return <label><span>URL interna *</span><input required placeholder="/produtos?ordem=recentes" value={draft.destination_value} aria-invalid={Boolean(error)} aria-describedby={error ? "navigation-destination-error" : undefined} onChange={(event) => onChange(event.target.value)} />{error ? <small className="admin-field-error" id="navigation-destination-error" role="alert">{error}</small> : null}</label>;
  const options = draft.destination_type === "category" ? categories : draft.destination_type === "collection" ? collections : pages.map(([name, slug]) => ({ id: slug, name, slug, active: true }));
  return <label><span>{draft.destination_type === "category" ? "Categoria" : draft.destination_type === "collection" ? "Coleção" : "Página"} *</span><select required value={draft.destination_value} aria-invalid={Boolean(error)} aria-describedby={error ? "navigation-destination-error" : undefined} onChange={(event) => onChange(event.target.value)}><option value="">{options.length ? "Escolha um destino" : "Nenhuma opção cadastrada"}</option>{options.map((item) => <option key={item.id} value={item.slug}>{item.name}{item.active ? "" : " (inativo)"}</option>)}</select>{error ? <small className="admin-field-error" id="navigation-destination-error" role="alert">{error}</small> : null}</label>;
}

function destinationLabel(item: NavigationItem, categories: Target[], collections: Target[]) {
  if (item.destination_type === "category") return `Categoria: ${categories.find((target) => target.slug === item.destination_value)?.name ?? item.destination_value}`;
  if (item.destination_type === "collection") return `Coleção: ${collections.find((target) => target.slug === item.destination_value)?.name ?? item.destination_value}`;
  return item.destination_value;
}
