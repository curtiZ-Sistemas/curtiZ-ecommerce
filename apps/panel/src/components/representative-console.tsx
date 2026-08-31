"use client";

import { resolvePublicAppUrls } from "@curtiz/config";

import {
  Check,
  FileImage,
  LoaderCircle,
  PackageCheck,
  Plus,
  ShieldAlert,
  Users,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelRole } from "./panel-shell";
import { PanelDrawer } from "./panel-drawer";
import { usePanelPrompt } from "./panel-prompt";

type Application = {
  id: string;
  publicCode: string;
  fullName?: string;
  email?: string;
  status: string;
  updatedAt: string;
};

const storeOrigin = () => {
  return resolvePublicAppUrls(
    typeof window === "undefined" ? undefined : window.location.href
  ).storeUrl;
};

export function RepresentativeConsole({ role, section }: { role: PanelRole; section: string }) {
  if (section === "solicitacoes-representantes" || section === "representantes") {
    return <Applications role={role} />;
  }
  if (section === "kits-representantes") {
    return (
      <HonestState
        icon={<PackageCheck />}
        title="Fila de kits"
        description="Pedidos pagos aparecem aqui para separação, conferência e expedição. Custos e comissões não são expostos ao Operacional."
      />
    );
  }
  if (section === "integridade-representantes") {
    return (
      <HonestState
        icon={<ShieldAlert />}
        title="Integridade do módulo"
        description="Verificações remotas de ciclos, duplicidades, lançamentos idempotentes e fechamentos bloqueados são exibidas sem permitir mutações financeiras."
      />
    );
  }
  if (section === "criativos") {
    return <CreativeManager role={role} />;
  }
  return (
    <HonestState
      icon={<Users />}
      title="Configuração de representantes"
      description="Níveis, critérios, metas, kits e regras de comissão são versionados no banco; não existem percentuais fixos no componente."
    />
  );
}

type Creative = {
  id: string;
  title: string;
  campaign?: string;
  description?: string;
  type?: string;
  asset_type?: string;
  platform: string;
  status: string;
  caption?: string;
  caption_text?: string;
  demo?: true;
};

type InternalCapabilities = Record<string, boolean>;

async function loadInternalCapabilities(): Promise<InternalCapabilities> {
  const response = await fetch("/api/internal-capabilities", { cache: "no-store" });
  const payload = (await response.json()) as {
    capabilities?: InternalCapabilities;
    message?: string;
  };
  if (!response.ok) throw new Error(payload.message ?? "Não foi possível confirmar as permissões.");
  return payload.capabilities ?? {};
}

function CreativeManager({ role }: { role: PanelRole }) {
  const requestPrompt = usePanelPrompt();
  const [items, setItems] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [capabilities, setCapabilities] = useState<InternalCapabilities>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);
  const allowed = role === "administracao" || role === "gerencia";
  const canCreate = allowed && capabilities["creatives.manage"] === true;

  const load = () => {
    setLoading(true);
    setLoadError("");
    void Promise.all([
      fetch(`${storeOrigin()}/api/creatives?scope=internal`, {
        credentials: "include",
        cache: "no-store"
      }).then(async (response) => {
        const result = (await response.json()) as { creatives?: Creative[]; message?: string };
        if (!response.ok) throw new Error(result.message ?? "Falha ao carregar criativos.");
        return result.creatives ?? [];
      }),
      loadInternalCapabilities()
    ])
      .then(([creatives, nextCapabilities]) => {
        setItems(creatives);
        setCapabilities(nextCapabilities);
      })
      .catch((reason: unknown) => {
        setItems([]);
        setCapabilities({});
        setLoadError(reason instanceof Error ? reason.message : "Falha inesperada.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !canCreate) return;
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(form);
      delete payload.file;
      const response = await fetch(`${storeOrigin()}/api/creatives`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", ...payload })
      });
      const result = (await response.json()) as { id?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível criar o criativo.");
      const file = form.get("file");
      if (file instanceof File && file.size > 0 && result.id) {
        const upload = new FormData();
        upload.set("creativeId", result.id);
        upload.set("file", file);
        const uploadResponse = await fetch(`${storeOrigin()}/api/creatives/upload`, {
          method: "POST",
          credentials: "include",
          body: upload
        });
        if (!uploadResponse.ok) {
          const uploadResult = (await uploadResponse.json()) as { message?: string };
          throw new Error(uploadResult.message ?? "Criativo salvo, mas o arquivo não foi enviado.");
        }
      }
      event.currentTarget.reset();
      setMessage("Criativo salvo como rascunho.");
      setCreateDirty(false);
      setCreateOpen(false);
      load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  };

  const transition = async (creativeId: string, status: string) => {
    const reason = await requestPrompt({
      title: "Alterar status do criativo",
      label: "Motivo da transição",
      minLength: 3
    });
    if (!reason || reason.trim().length < 3 || pending) return;
    setPending(true);
    try {
      const response = await fetch(`${storeOrigin()}/api/creatives`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "transition", creativeId, status, reason })
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Transição não permitida.");
      load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="creative-manager-layout">
      <section className="panel-card representative-console">
        <header>
          <div>
            <h1>Criativos</h1>
            <p>Somente materiais publicados e elegíveis chegam ao portal.</p>
          </div>
          {canCreate ? (
            <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
              <Plus /> Novo criativo
            </button>
          ) : null}
        </header>
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
        {loading ? (
          <div className="panel-loading">
            <LoaderCircle className="spin" />
          </div>
        ) : loadError ? (
          <div className="panel-error" role="alert">
            <ShieldAlert />
            <p>{loadError}</p>
            <button type="button" onClick={load}>
              Tentar novamente
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="admin-empty-state">
            <FileImage />
            <h3>Nenhum criativo encontrado</h3>
            <p>Crie o primeiro material para iniciar a biblioteca.</p>
            {canCreate ? (
              <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
                <Plus /> Criar primeiro criativo
              </button>
            ) : null}
          </div>
        ) : (
          <div className="creative-manager-list">
            {items.map((item) => (
              <article key={item.id}>
                <div>
                  <small>
                    {item.platform} · {item.type ?? item.asset_type}
                  </small>
                  <strong>{item.title}</strong>
                  <p>{item.campaign ?? item.description}</p>
                </div>
                <span className={`status ${item.status}`}>{label(item.status)}</span>
                <div className="review-actions">
                  {item.status === "draft" && capabilities["creatives.manage"] === true && (
                    <button onClick={() => void transition(item.id, "pending_review")}>
                      Enviar à revisão
                    </button>
                  )}
                  {item.status === "pending_review" &&
                    capabilities["creatives.approve"] === true && (
                      <>
                        <button
                          className="approve"
                          onClick={() => void transition(item.id, "approved")}
                        >
                          Aprovar
                        </button>
                        <button
                          className="reject"
                          onClick={() => void transition(item.id, "rejected")}
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                  {item.status === "approved" && capabilities["creatives.publish"] === true && (
                    <button
                      className="approve"
                      onClick={() => void transition(item.id, "published")}
                    >
                      Publicar
                    </button>
                  )}
                  {item.status === "published" && capabilities["creatives.publish"] === true && (
                    <button onClick={() => void transition(item.id, "archived")}>Arquivar</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <PanelDrawer
        open={createOpen}
        title="Novo criativo"
        eyebrow="Biblioteca"
        dirty={createDirty}
        onClose={() => {
          setCreateOpen(false);
          setCreateDirty(false);
        }}
      >
        <p className="product-media-note">
          O material nasce como rascunho e segue o fluxo real de aprovação.
        </p>
        <form
          className="creative-manager-form"
          onChange={() => setCreateDirty(true)}
          onSubmit={(event) => void create(event)}
        >
          <label>
            <span>Título</span>
            <input name="title" minLength={3} maxLength={160} required />
          </label>
          <label>
            <span>Campanha</span>
            <input name="campaign" minLength={3} maxLength={160} required />
          </label>
          <div>
            <label>
              <span>Tipo</span>
              <select name="type">
                <option value="caption">Legenda</option>
                <option value="image">Imagem</option>
                <option value="video">Vídeo</option>
              </select>
            </label>
            <label>
              <span>Plataforma</span>
              <input name="platform" placeholder="Instagram, WhatsApp…" required />
            </label>
          </div>
          <label>
            <span>Legenda ou instrução</span>
            <textarea name="caption" minLength={3} maxLength={4000} rows={5} required />
          </label>
          <label>
            <span>Arquivo opcional</span>
            <input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf,application/zip"
            />
          </label>
          <div className="creative-manager-footer">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setCreateDirty(false);
              }}
              disabled={pending}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={pending || !canCreate}>
              {pending ? <LoaderCircle className="spin" /> : <FileImage />} Salvar rascunho
            </button>
          </div>
        </form>
      </PanelDrawer>
    </div>
  );
}

function Applications({ role }: { role: PanelRole }) {
  const requestPrompt = usePanelPrompt();
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<InternalCapabilities>({});
  const canReview =
    (role === "administracao" || role === "gerencia") &&
    capabilities["representatives.manage"] === true;

  const load = () => {
    setLoading(true);
    setError("");
    void Promise.all([
      fetch(`${storeOrigin()}/api/representatives?scope=internal`, {
        credentials: "include",
        cache: "no-store"
      }).then(async (response) => {
        const result = (await response.json()) as {
          applications?: Application[];
          message?: string;
        };
        if (!response.ok) throw new Error(result.message ?? "Não foi possível carregar a fila.");
        return result.applications ?? [];
      }),
      loadInternalCapabilities()
    ])
      .then(([applications, nextCapabilities]) => {
        setItems(applications);
        setCapabilities(nextCapabilities);
      })
      .catch((reason: unknown) => {
        setItems([]);
        setCapabilities({});
        setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const review = async (
    applicationId: string,
    decision: "start_review" | "request_documents" | "approve" | "reject"
  ) => {
    const reason = await requestPrompt({
      title: "Revisar solicitação",
      label: "Motivo desta decisão",
      minLength: 3
    });
    if (!reason || reason.trim().length < 3 || pending) return;
    setPending(applicationId);
    setError("");
    try {
      const response = await fetch(`${storeOrigin()}/api/representatives`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "review", applicationId, decision, reason })
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Decisão não aplicada.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha inesperada.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="panel-card representative-console">
      <header>
        <div>
          <h2>Solicitações de representantes</h2>
          <p>Fila auditada, sem exposição de documentos ou CPF nesta visão.</p>
        </div>
        <span>{items.length} registros</span>
      </header>
      {loading ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" /> Carregando
        </div>
      ) : error ? (
        <div className="panel-error">
          <ShieldAlert />
          <p>{error}</p>
          <button onClick={load}>Tentar novamente</button>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Solicitação</th>
                <th>Candidata</th>
                <th>Status</th>
                <th>Atualização</th>
                {canReview && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.publicCode}</strong>
                  </td>
                  <td>
                    {item.fullName ?? "Dados protegidos"}
                    {item.email && <small>{maskEmail(item.email)}</small>}
                  </td>
                  <td>
                    <span className={`status ${item.status}`}>{label(item.status)}</span>
                  </td>
                  <td>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.updatedAt))}</td>
                  {canReview && (
                    <td>
                      <div className="review-actions">
                        {item.status === "submitted" && (
                          <button
                            disabled={pending === item.id}
                            onClick={() => void review(item.id, "start_review")}
                          >
                            Iniciar análise
                          </button>
                        )}
                        {item.status === "under_review" && (
                          <>
                            <button
                              className="approve"
                              disabled={pending === item.id}
                              onClick={() => void review(item.id, "approve")}
                            >
                              <Check /> Aprovar
                            </button>
                            <button
                              disabled={pending === item.id}
                              onClick={() => void review(item.id, "request_documents")}
                            >
                              Correção
                            </button>
                            <button
                              className="reject"
                              disabled={pending === item.id}
                              onClick={() => void review(item.id, "reject")}
                            >
                              <X /> Rejeitar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HonestState({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <section className="panel-card representative-honest-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <small>
        O painel mostrará dados confirmados assim que o Supabase remoto de homologação estiver
        conectado.
      </small>
    </section>
  );
}

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 2) ?? ""}***@${domain ?? ""}`;
};

const label = (status: string) =>
  ({
    draft: "Rascunho",
    submitted: "Enviada",
    under_review: "Em análise",
    documents_pending: "Correção solicitada",
    approved: "Aprovada",
    rejected: "Rejeitada",
    suspended: "Suspensa",
    cancelled: "Cancelada"
  })[status] ?? status;
