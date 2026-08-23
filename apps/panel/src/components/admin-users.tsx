"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, Pencil, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PanelDrawer } from "./panel-drawer";

const editableRoles = ["customer", "admin", "operational", "technical"] as const;
type EditableRole = (typeof editableRoles)[number];
const roleLabels: Record<string, string> = { customer: "Cliente", admin: "Administrador", operational: "Operador", manager: "Gerencial", technical: "Técnico", representative: "Representante" };

type User = {
  id: string; full_name: string; email_snapshot: string; status: string; updated_at: string;
  roles: string[]; editable: boolean;
  lastAccessChange: { action?: string; reason?: string; created_at?: string } | null;
};
type Capabilities = { manage: boolean; invite: boolean; manageableRoles: string[]; canManageStatus: boolean };
type UsersResponse = { users?: User[]; total?: number; pageSize?: number; message?: string; capabilities?: Partial<Capabilities> };
type AccessDraft = { status: string; roles: EditableRole[]; reason: string };

const accessDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const defaultCapabilities: Capabilities = { manage: false, invite: false, manageableRoles: [], canManageStatus: false };

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<User | null>(null);
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities>(defaultCapabilities);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (submitted) params.set("q", submitted);
      const response = await fetch(`/api/admin/users?${params}`, { cache: "no-store" });
      const result = (await response.json()) as UsersResponse;
      if (!response.ok) throw new Error(result.message);
      setUsers(result.users ?? []); setTotal(result.total ?? 0); setPageSize(result.pageSize ?? 20);
      setCapabilities({ manage: result.capabilities?.manage === true, invite: result.capabilities?.invite === true, manageableRoles: result.capabilities?.manageableRoles ?? [], canManageStatus: result.capabilities?.canManageStatus === true });
    } catch (error) {
      setUsers([]); setTotal(0); setCapabilities(defaultCapabilities);
      setLoadError(error instanceof Error && error.message ? error.message : "Não foi possível carregar os usuários.");
    } finally { setLoading(false); }
  }, [page, submitted]);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (user: User) => {
    setEditing(user);
    setDraft({ status: user.status, roles: editableRoles.filter((role) => user.roles.includes(role)), reason: "" });
    setReviewing(false); setMessage("");
  };
  const closeEditor = () => { setEditing(null); setDraft(null); setReviewing(false); };

  const prepareSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !draft || pending) return;
    if (draft.status === "active" && draft.roles.length === 0 && !editing.roles.some((role) => ["manager", "representative"].includes(role))) {
      setMessage("Mantenha pelo menos um acesso ou desative a conta de forma explícita."); return;
    }
    if (draft.reason.trim().length < 10) { setMessage("Explique a alteração em pelo menos 10 caracteres."); return; }
    setReviewing(true);
  };

  const save = async () => {
    if (!editing || !draft || pending) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: editing.id, status: draft.status, roles: draft.roles, updatedAt: editing.updated_at, reason: draft.reason }) });
      const result = (await response.json()) as UsersResponse;
      if (!response.ok) throw new Error(result.message);
      closeEditor(); await load(); setMessage(result.message ?? "Acessos atualizados e auditados.");
    } catch (error) {
      setReviewing(false); setMessage(error instanceof Error && error.message ? error.message : "Não foi possível atualizar os acessos.");
    } finally { setPending(false); }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const originalMutableRoles = useMemo(() => editableRoles.filter((role) => editing?.roles.includes(role)), [editing]);
  const dirty = Boolean(editing && draft && (draft.status !== editing.status || draft.reason.length > 0 || draft.roles.join("|") !== originalMutableRoles.join("|")));
  const changeSummary = editing && draft ? [
    ...(draft.status !== editing.status ? [`Status: ${editing.status} → ${draft.status}`] : []),
    ...editableRoles.flatMap((role) => { const had = editing.roles.includes(role); const has = draft.roles.includes(role); return had === has ? [] : [`${has ? "Adicionar" : "Remover"} ${roleLabels[role]}`]; })
  ] : [];

  return (
    <section className="panel-card admin-resource access-management">
      <header className="admin-resource-header"><div><h1>Usuários e acessos</h1><p>Gerencie somente os acessos autorizados para sua função.</p></div></header>
      <form className="admin-search standalone" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmitted(query.trim()); }}>
        <Search aria-hidden="true" /><label className="sr-only" htmlFor="user-search">Buscar usuário</label>
        <input id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou e-mail" />
        <button className="secondary-button" type="submit">Buscar</button>
        {query || submitted ? <button className="secondary-button filter-clear-button" type="button" onClick={() => { setQuery(""); setSubmitted(""); setPage(1); }}><X aria-hidden="true" /> Limpar</button> : null}
      </form>
      {message ? <p className="admin-feedback" role="status">{message}</p> : null}
      {loading ? <div className="admin-loading"><LoaderCircle className="spin" /> Carregando usuários</div> : loadError ? (
        <div className="admin-empty-state" role="alert"><h3>Não foi possível carregar os usuários</h3><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Tentar novamente</button></div>
      ) : users.length === 0 ? <div className="admin-empty-state"><h3>Nenhum usuário encontrado</h3><p>Ajuste o nome ou e-mail informado.</p></div> : (
        <div className="admin-table-wrap"><table className="data-table admin-data-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Acessos</th><th>Status</th><th>Última alteração</th><th>Ação</th></tr></thead><tbody>
          {users.map((user) => <tr key={user.id}>
            <td data-label="Nome">{user.full_name}</td><td data-label="E-mail">{user.email_snapshot}</td>
            <td data-label="Acessos"><span className="access-badges">{user.roles.map((role) => <small className="access-badge" key={role}>{roleLabels[role] ?? role}</small>)}</span></td>
            <td data-label="Status">{user.status}</td>
            <td data-label="Última alteração">{user.lastAccessChange?.created_at ? <span className="admin-user-history"><strong>Acessos atualizados</strong><small>{accessDate.format(new Date(user.lastAccessChange.created_at))}{user.lastAccessChange.reason ? ` · ${user.lastAccessChange.reason}` : ""}</small></span> : "Sem alterações"}</td>
            <td className="admin-row-actions">{user.editable ? <button type="button" onClick={() => openEditor(user)} aria-label={`Gerenciar acessos de ${user.full_name}`}><Pencil /></button> : <small>Seu próprio acesso</small>}</td>
          </tr>)}
        </tbody></table></div>
      )}
      {!loading && users.length > 0 ? <footer className="admin-pagination"><span>{total.toLocaleString("pt-BR")} usuários</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Página anterior"><ChevronLeft /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)} aria-label="Próxima página"><ChevronRight /></button></div></footer> : null}

      <PanelDrawer open={Boolean(editing && draft)} title={editing?.full_name ?? "Gerenciar acessos"} eyebrow="Controle de acesso" dirty={dirty && !pending} onClose={closeEditor} size="medium">
        {editing && draft ? reviewing ? <section className="access-review">
          <ShieldCheck aria-hidden="true" /><h3>Confirme as alterações</h3>
          {changeSummary.length ? <ul>{changeSummary.map((change) => <li key={change}>{change}</li>)}</ul> : <p>Nenhum acesso ou status foi alterado.</p>}
          <p><strong>Justificativa:</strong> {draft.reason}</p>
          <footer><button className="secondary-button" type="button" onClick={() => setReviewing(false)}>Voltar</button><button className="primary-button" type="button" onClick={() => void save()} disabled={pending}>{pending ? <LoaderCircle className="spin" /> : null} Confirmar alterações</button></footer>
        </section> : <form className="access-form" onSubmit={prepareSave}>
          <div className="access-identity"><strong>{editing.email_snapshot}</strong><small>Gerencial é protegido e nunca pode ser alterado nesta interface.</small></div>
          <fieldset><legend>Acessos</legend><p>Selecione apenas os ambientes necessários para esta pessoa.</p>
            <div className="access-options">{editableRoles.map((role) => {
              const allowed = capabilities.manageableRoles.includes(role); const checked = draft.roles.includes(role);
              return <label className={allowed ? "" : "protected"} key={role}><input type="checkbox" checked={checked} disabled={!allowed} onChange={(event) => setDraft((current) => current ? { ...current, roles: event.target.checked ? [...current.roles, role].sort() : current.roles.filter((item) => item !== role) } : current)} /><span><strong>{roleLabels[role]}</strong><small>{allowed ? "Você pode alterar este acesso" : checked ? "Acesso protegido para sua função" : "Não gerenciável nesta área"}</small></span></label>;
            })}</div>
            {editing.roles.filter((role) => !editableRoles.includes(role as EditableRole)).map((role) => <div className="protected-role" key={role}><ShieldCheck aria-hidden="true" /><span><strong>{roleLabels[role] ?? role}</strong><small>Acesso protegido, somente leitura</small></span></div>)}
          </fieldset>
          <label><span>Status da conta</span><select value={draft.status} disabled={!capabilities.canManageStatus} onChange={(event) => setDraft((current) => current ? { ...current, status: event.target.value } : current)}><option value="active">Ativo</option><option value="suspended">Suspenso</option><option value="disabled">Bloqueado</option></select></label>
          <label><span>Justificativa *</span><textarea value={draft.reason} onChange={(event) => setDraft((current) => current ? { ...current, reason: event.target.value } : current)} minLength={10} maxLength={500} required rows={4} placeholder="Explique por que estes acessos precisam mudar" /></label>
          <footer><button className="primary-button" type="submit" disabled={pending || changeSummary.length === 0}>Revisar alterações</button></footer>
        </form> : null}
      </PanelDrawer>
    </section>
  );
}
