"use client";

import { resolvePublicAppUrls } from "@curtiz/config";

import {
  FileImage,
  LoaderCircle,
  PackageCheck,
  Plus,
  ShieldAlert,
  Users
} from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelRole } from "./panel-shell";
import { PanelDrawer } from "./panel-drawer";
import { usePanelPrompt } from "./panel-prompt";
import {
  type Application,
  ApplicationsTable,
  recordsLabel,
  ReviewDialog,
  type ReviewDecision,
  reviewDecisionCopy
} from "./representative-application-table";

const storeOrigin = () => {
  return resolvePublicAppUrls(
    typeof window === "undefined" ? undefined : window.location.href
  ).storeUrl;
};

export function RepresentativeConsole({ role, section, initialStatus = "" }: { role: PanelRole; section: string; initialStatus?: string }) {
  if (section === "solicitacoes-representantes" || section === "representantes") {
    return <Applications key={initialStatus} role={role} initialStatus={initialStatus} />;
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

function Applications({ role, initialStatus }: { role: PanelRole; initialStatus: string }) {
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{ item: Application; decision: ReviewDecision } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [capabilities, setCapabilities] = useState<InternalCapabilities>({});
  const [statusFilter, setStatusFilter] = useState(applicationFilters.some(([value]) => value === initialStatus) ? initialStatus : "");
  const visibleItems = items.filter((item) => matchesApplicationFilter(item.status, statusFilter));
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

  const openDialog = (item: Application, decision: ReviewDecision) => {
    setDialogError("");
    setNotice("");
    setDialog({ item, decision });
  };
  const closeDialog = () => setDialog(null);

  const submitReview = async (reason: string) => {
    if (!dialog || saving) return;
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch(`${storeOrigin()}/api/representatives`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review",
          applicationId: dialog.item.id,
          decision: dialog.decision,
          reason
        })
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Decisão não aplicada.");
      setNotice(`${reviewDecisionCopy(dialog.decision).title}: ${dialog.item.publicCode} atualizada.`);
      setDialog(null);
      load();
    } catch (reasonError) {
      setDialogError(reasonError instanceof Error ? reasonError.message : "Falha inesperada.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel-card representative-console">
      <header>
        <div>
          <h2>Solicitações de representantes</h2>
          <p>Decisões ficam registradas com justificativa.</p>
        </div>
        <span>{recordsLabel(visibleItems.length)}</span>
      </header>
      <label className="representative-status-filter">
        Situação
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          {applicationFilters.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      {notice && <p role="status">{notice}</p>}
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
        <ApplicationsTable items={visibleItems} role={role} canReview={canReview} onDecision={openDialog} />
      )}
      {dialog && (
        <ReviewDialog
          key={`${dialog.item.id}:${dialog.decision}`}
          publicCode={dialog.item.publicCode}
          decision={dialog.decision}
          saving={saving}
          error={dialogError}
          onCancel={closeDialog}
          onConfirm={(reason) => void submitReview(reason)}
        />
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

// Filtros aceitos em ?status= (a busca global abre a fila já em "pendentes").
const pendingApplicationStatuses = ["submitted", "under_review", "documents_pending"];
const applicationFilters: ReadonlyArray<readonly [string, string]> = [
  ["", "Todas"],
  ["pendentes", "Pendentes (enviadas, em análise e correção)"],
  ["submitted", "Enviadas"],
  ["under_review", "Em análise"],
  ["documents_pending", "Correção solicitada"],
  ["approved", "Aprovadas"],
  ["rejected", "Rejeitadas"]
];
const matchesApplicationFilter = (status: string, filter: string) =>
  !filter || (filter === "pendentes" ? pendingApplicationStatuses.includes(status) : status === filter);

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
