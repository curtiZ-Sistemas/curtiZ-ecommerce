"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState
} from "react";

type Permission = {
  id: string;
  code: string;
  description: string;
};

type UserOption = {
  id: string;
  fullName: string;
};

type PermissionData = {
  permissions?: Permission[];
  users?: UserOption[];
  overrides?: Array<Record<string, unknown>>;
  message?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "—";
}

function getFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function readPermissionData(response: Response): Promise<PermissionData> {
  const payload: unknown = await response.json();

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload;
}

export function AdminPermissions() {
  const [data, setData] = useState<PermissionData>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/admin/permissions", {
        cache: "no-store"
      });
      const result = await readPermissionData(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível carregar as permissões.");
      }

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

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const userId = getFormString(form, "userId");
    const permissionCode = getFormString(form, "permissionCode");
    const allowed = getFormString(form, "allowed") === "true";
    const expiresAtInput = getFormString(form, "expiresAt");
    const reason = getFormString(form, "reason");
    const expiresAtDate = new Date(expiresAtInput);

    if (!userId || !permissionCode || !expiresAtInput || !reason) {
      setMessage("Preencha todos os campos obrigatórios.");
      return;
    }

    if (Number.isNaN(expiresAtDate.getTime())) {
      setMessage("Informe uma data de validade válida.");
      return;
    }

    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userId,
          permissionCode,
          allowed,
          expiresAt: expiresAtDate.toISOString(),
          reason
        })
      });
      const result = await readPermissionData(response);

      if (!response.ok) {
        throw new Error(result.message || "Não foi possível registrar a permissão.");
      }

      setMessage(result.message ?? "Permissão registrada.");
      formElement.reset();
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível registrar."
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

        {message ? (
          <p className="admin-feedback" role="status">
            {message}
          </p>
        ) : null}

        {loading ? (
          <div className="admin-loading">
            <LoaderCircle className="spin" /> Carregando
          </div>
        ) : (
          <form
            className="admin-permission-form"
            onSubmit={(event) => void submit(event)}
          >
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
                      !permission.code.startsWith("users.") &&
                      permission.code !== "audit.read"
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
              <textarea
                name="reason"
                minLength={10}
                maxLength={500}
                required
                rows={4}
              />
            </label>

            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : <ShieldCheck />}
              Registrar permissão
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
            <p className="admin-empty-copy">
              Nenhuma alteração temporária registrada.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}