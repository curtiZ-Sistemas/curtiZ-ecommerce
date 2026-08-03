"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Permission = { id: string; code: string; description: string };
type UserOption = { id: string; fullName: string };
type PermissionData = {
  permissions?: Permission[];
  users?: UserOption[];
  overrides?: Array<Record<string, unknown>>;
  message?: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "—");

export function AdminPermissions() {
  const [data, setData] = useState<PermissionData>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/permissions", { cache: "no-store" });
      const result = (await response.json()) as PermissionData;
      if (!response.ok) throw new Error(result.message);
      setData(result);
      setMessage("");
    } catch {
      setMessage("Não foi possível carregar as permissões.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: form.get("userId"),
          permissionCode: form.get("permissionCode"),
          allowed: form.get("allowed") === "true",
          expiresAt: new Date(String(form.get("expiresAt"))).toISOString(),
          reason: form.get("reason")
        })
      });
      const result = (await response.json()) as PermissionData;
      if (!response.ok) throw new Error(result.message);
      setMessage(result.message ?? "Permissão registrada.");
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message ? error.message : "Não foi possível registrar."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="admin-permission-layout">
      <section className="panel-card">
        <header className="admin-resource-header">
          <div>
            <h2>Permissões</h2>
            <p>Conceda ou negue permissões temporárias sem alterar papéis.</p>
          </div>
        </header>
        {message && (
          <p className="admin-feedback" role="status">
            {message}
          </p>
        )}
        {loading ? (
          <div className="admin-loading">
            <LoaderCircle className="spin" /> Carregando
          </div>
        ) : (
          <form className="admin-permission-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Usuário</span>
              <select name="userId" required>
                <option value="">Selecione</option>
                {data.users?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Permissão</span>
              <select name="permissionCode" required>
                <option value="">Selecione</option>
                {data.permissions
                  ?.filter(
                    (permission) =>
                      !permission.code.startsWith("users.") && permission.code !== "audit.read"
                  )
                  .map((permission) => (
                    <option key={permission.id} value={permission.code}>
                      {permission.code}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Decisão</span>
              <select name="allowed" defaultValue="true">
                <option value="true">Permitir</option>
                <option value="false">Negar</option>
              </select>
            </label>
            <label>
              <span>Validade</span>
              <input name="expiresAt" type="datetime-local" required />
            </label>
            <label className="wide">
              <span>Justificativa</span>
              <textarea name="reason" minLength={10} maxLength={500} required rows={4} />
            </label>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : <ShieldCheck />} Registrar permissão
            </button>
          </form>
        )}
      </section>
      <section className="panel-card">
        <h2>Alterações recentes</h2>
        <div className="admin-compact-list">
          {data.overrides?.length ? (
            data.overrides.map((override, index) => {
              const permission =
                override.permissions && typeof override.permissions === "object"
                  ? text((override.permissions as Record<string, unknown>).code)
                  : "Permissão";
              return (
                <div key={`${text(override.user_id)}-${index}`}>
                  <span>
                    <strong>{permission}</strong>
                    <small>{text(override.reason)}</small>
                  </span>
                  <strong>{override.allowed === true ? "Permitida" : "Negada"}</strong>
                </div>
              );
            })
          ) : (
            <p className="admin-empty-copy">Nenhuma alteração temporária registrada.</p>
          )}
        </div>
      </section>
    </div>
  );
}
