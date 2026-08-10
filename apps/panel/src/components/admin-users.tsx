"use client";

import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Search,
  ShieldAlert,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type User = {
  id: string;
  full_name: string;
  email_snapshot: string;
  status: string;
  roles: string[];
  editable: boolean;
  lastAccessChange: {
    action?: string;
    reason?: string;
    created_at?: string;
  } | null;
};

type UsersResponse = {
  users?: User[];
  total?: number;
  pageSize?: number;
  message?: string;
};

const accessDate = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

export function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (submitted) params.set("q", submitted);
      const response = await fetch(`/api/admin/users?${params}`, { cache: "no-store" });
      const result = (await response.json()) as UsersResponse;
      if (!response.ok) throw new Error(result.message);
      setUsers(result.users ?? []);
      setTotal(result.total ?? 0);
      setPageSize(result.pageSize ?? 20);
      setMessage("");
    } catch {
      setMessage("Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  }, [page, submitted]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || pending) return;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: editing.id,
          status: form.get("status"),
          role: form.get("role"),
          reason: form.get("reason")
        })
      });
      const result = (await response.json()) as UsersResponse;
      if (!response.ok) throw new Error(result.message);
      const successMessage = result.message ?? "Acesso atualizado.";
      setEditing(null);
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message ? error.message : "Não foi possível atualizar."
      );
    } finally {
      setPending(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="panel-card admin-resource">
      <header className="admin-resource-header">
        <div>
          <h1>Usuários</h1>
          <p>Consulte acessos, bloqueie contas e atribua papéis sem escalada para Administrador.</p>
        </div>
      </header>
      <form
        className="admin-search standalone"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSubmitted(query.trim());
        }}
      >
        <Search aria-hidden="true" />
        <label className="sr-only" htmlFor="user-search">
          Buscar usuário
        </label>
        <input
          id="user-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome ou e-mail"
        />
        <button className="secondary-button" type="submit">
          Buscar
        </button>
        {query || submitted ? (
          <button className="secondary-button filter-clear-button" type="button" onClick={() => { setQuery(""); setSubmitted(""); setPage(1); }}>
            <X aria-hidden="true" /> Limpar
          </button>
        ) : null}
      </form>
      {message && (
        <p className="admin-feedback" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <div className="admin-loading">
          <LoaderCircle className="spin" /> Carregando usuários
        </div>
      ) : users.length === 0 ? (
        <div className="admin-empty-state">
          <h3>Nenhum usuário encontrado</h3>
          <p>Ajuste a busca. Novos acessos administrativos continuam no fluxo protegido de convite e aprovação.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="data-table admin-data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papéis</th>
                <th>Status</th>
                <th>Última alteração</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td data-label="Nome">{user.full_name}</td>
                  <td data-label="E-mail">{user.email_snapshot}</td>
                  <td data-label="Papéis">{user.roles.join(", ") || "Sem papel"}</td>
                  <td data-label="Status">{user.status}</td>
                  <td data-label="Última alteração">
                    {user.lastAccessChange?.created_at ? (
                      <span className="admin-user-history">
                        <strong>
                          {user.lastAccessChange.action === "permission_override"
                            ? "Permissão temporária"
                            : "Acesso atualizado"}
                        </strong>
                        <small>
                          {accessDate.format(new Date(user.lastAccessChange.created_at))}
                          {user.lastAccessChange.reason
                            ? ` · ${user.lastAccessChange.reason}`
                            : ""}
                        </small>
                      </span>
                    ) : (
                      "Sem alterações"
                    )}
                  </td>
                  <td className="admin-row-actions">
                    {user.editable ? (
                      <button
                        type="button"
                        onClick={() => setEditing(user)}
                        aria-label={`Editar acesso de ${user.full_name}`}
                      >
                        <Pencil />
                      </button>
                    ) : (
                      <small>Fluxo protegido</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && users.length > 0 ? (
        <footer className="admin-pagination">
          <span>{total.toLocaleString("pt-BR")} usuários</span>
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
      {editing && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-form-title"
          >
            <header>
              <div>
                <span>Controle de acesso</span>
                <h2 id="user-form-title">{editing.full_name}</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fechar">
                <X />
              </button>
            </header>
            <form onSubmit={(event) => void save(event)}>
              <p className="admin-access-alert">
                <ShieldAlert /> Contas Administradoras usam convite e aprovação separados.
              </p>
              <div className="admin-form-grid">
                <label>
                  <span>Status</span>
                  <select name="status" defaultValue={editing.status}>
                    <option value="active">Ativo</option>
                    <option value="suspended">Suspenso</option>
                    <option value="disabled">Bloqueado</option>
                  </select>
                </label>
                <label>
                  <span>Papel</span>
                  <select
                    name="role"
                    defaultValue={
                      editing.roles.find((role) =>
                        ["operational", "manager", "technical", "representative"].includes(role)
                      ) ?? "customer"
                    }
                  >
                    <option value="customer">Cliente</option>
                    <option value="operational">Operacional</option>
                    <option value="manager">Gerência</option>
                    <option value="technical">Técnico</option>
                  </select>
                </label>
                <label className="wide">
                  <span>Justificativa *</span>
                  <textarea name="reason" minLength={10} maxLength={500} required rows={4} />
                </label>
              </div>
              <footer>
                <button className="secondary-button" type="button" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button className="primary-button" type="submit" disabled={pending}>
                  {pending && <LoaderCircle className="spin" />} Salvar acesso
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
