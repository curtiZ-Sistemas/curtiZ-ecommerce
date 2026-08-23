"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Pencil, Plus, Power } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  promotionBarMutationSchema,
  type PromotionBarMutation
} from "@/lib/promotion-bar";

type PromotionMessage = {
  id: string;
  message_text: string;
  cta_label: string | null;
  link_path: string | null;
  active: boolean;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

type Draft = {
  id?: string;
  text: string;
  cta: string;
  href: string;
  active: boolean;
  sortOrder: number;
  startsAt: string;
  endsAt: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo"
});

const toInputDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date).replace(" ", "T");
};

const toIsoDate = (value: string) => (value ? new Date(value).toISOString() : null);

function isPromotionMessage(value: unknown): value is PromotionMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.message_text === "string" &&
    typeof row.active === "boolean" &&
    typeof row.sort_order === "number"
  );
}

function messageDraft(message: PromotionMessage): Draft {
  return {
    id: message.id,
    text: message.message_text,
    cta: message.cta_label ?? "",
    href: message.link_path ?? "",
    active: message.active,
    sortOrder: message.sort_order,
    startsAt: toInputDate(message.starts_at),
    endsAt: toInputDate(message.ends_at)
  };
}

function payloadFromDraft(draft: Draft): PromotionBarMutation {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    text: draft.text.trim(),
    active: draft.active,
    sortOrder: draft.sortOrder,
    href: draft.href.trim() || null,
    cta: draft.cta.trim() || null,
    startsAt: toIsoDate(draft.startsAt),
    endsAt: toIsoDate(draft.endsAt)
  };
}

export function PromotionBarManager() {
  const [messages, setMessages] = useState<PromotionMessage[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const activeCount = useMemo(
    () => messages.reduce((total, message) => total + Number(message.active), 0),
    [messages]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/promotion-bar", { cache: "no-store" });
      const body: unknown = await response.json();
      const result = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "Falha ao carregar.");
      setMessages(Array.isArray(result.messages) ? result.messages.filter(isPromotionMessage) : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a barra promocional.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async (method: "POST" | "PATCH", body: unknown) => {
    const response = await fetch("/api/promotion-bar", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as { message?: string };
    if (!response.ok) throw new Error(result.message ?? "Não foi possível salvar.");
    return result.message ?? "Alterações salvas.";
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || pending) return;
    setError("");
    setFeedback("");
    const payload = payloadFromDraft(draft);
    const parsed = promotionBarMutationSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
      return;
    }
    const wasActive = draft.id
      ? messages.find((message) => message.id === draft.id)?.active === true
      : false;
    if (draft.active && !wasActive && activeCount >= 3) {
      setError("Desative uma mensagem antes de ativar outra. O limite é de três.");
      return;
    }
    setPending(true);
    try {
      setFeedback(await request(draft.id ? "PATCH" : "POST", parsed.data));
      setDraft(undefined);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível salvar.");
    } finally {
      setPending(false);
    }
  };

  const toggle = async (message: PromotionMessage) => {
    if (!message.active && activeCount >= 3) {
      setError("Desative uma mensagem antes de ativar outra. O limite é de três.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const payload = payloadFromDraft({ ...messageDraft(message), active: !message.active });
      setFeedback(await request("PATCH", payload));
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Não foi possível alterar o estado.");
    } finally {
      setPending(false);
    }
  };

  const move = async (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= messages.length || pending) return;
    const ordered = [...messages];
    [ordered[index], ordered[destination]] = [ordered[destination]!, ordered[index]!];
    setPending(true);
    setError("");
    try {
      setFeedback(await request("PATCH", { action: "reorder", ids: ordered.map((item) => item.id) }));
      await load();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Não foi possível reordenar.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="promotion-manager">
      <header className="homepage-builder-header">
        <div>
          <p className="eyebrow">Conteúdo da loja</p>
          <h1>Barra promocional</h1>
          <p>Publique até três comunicados curtos acima do cabeçalho da loja.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            setDraft({
              text: "",
              cta: "",
              href: "",
              active: activeCount < 3,
              sortOrder: messages.length,
              startsAt: "",
              endsAt: ""
            })
          }
          disabled={pending}
        >
          <Plus /> Nova mensagem
        </button>
      </header>

      <div className="promotion-manager-status" aria-label="Limite de mensagens ativas">
        <strong>{activeCount} de 3 ativas</strong>
        <span>Alterações aparecem na loja em até aproximadamente um minuto.</span>
      </div>
      {feedback ? <p className="admin-success" role="status">{feedback}</p> : null}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      {draft ? (
        <form className="panel-card promotion-message-form" onSubmit={(event) => void submit(event)}>
          <header>
            <div>
              <h2>{draft.id ? "Editar mensagem" : "Nova mensagem"}</h2>
              <p>Somente texto simples e links internos da loja são aceitos.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>
              Cancelar
            </button>
          </header>
          <div className="admin-form-grid">
            <label className="wide">
              <span>Mensagem</span>
              <input
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                minLength={4}
                maxLength={140}
                required
              />
              <small>{draft.text.length}/140 caracteres</small>
            </label>
            <label>
              <span>Link interno opcional</span>
              <input
                value={draft.href}
                onChange={(event) => setDraft({ ...draft, href: event.target.value })}
                placeholder="/ofertas"
                maxLength={500}
              />
            </label>
            <label>
              <span>CTA opcional</span>
              <input
                value={draft.cta}
                onChange={(event) => setDraft({ ...draft, cta: event.target.value })}
                placeholder="Ver ofertas"
                maxLength={40}
              />
            </label>
            <label>
              <span>Início opcional</span>
              <input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} />
            </label>
            <label>
              <span>Término opcional</span>
              <input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} />
            </label>
            <label>
              <span>Ordem</span>
              <input type="number" min="0" max="999" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} required />
            </label>
            <label className="promotion-active-field">
              <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
              <span>Mensagem ativa</span>
            </label>
          </div>
          <footer>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="spin" /> : null}
              Salvar mensagem
            </button>
          </footer>
        </form>
      ) : null}

      {loading ? (
        <div className="admin-empty-state"><LoaderCircle className="spin" /><p>Carregando mensagens...</p></div>
      ) : messages.length === 0 ? (
        <div className="admin-empty-state"><h2>A barra está oculta</h2><p>Crie uma mensagem para exibi-la na loja.</p></div>
      ) : (
        <div className="promotion-message-list">
          {messages.map((message, index) => (
            <article className={message.active ? "panel-card active" : "panel-card"} key={message.id}>
              <div className="promotion-message-order"><span>Posição</span><strong>{index + 1}</strong></div>
              <div className="promotion-message-copy">
                <div><span className={message.active ? "status active" : "status"}>{message.active ? "Ativa" : "Inativa"}</span></div>
                <h2>{message.message_text}</h2>
                <p>{message.cta_label && message.link_path ? `${message.cta_label} · ${message.link_path}` : message.link_path ?? "Sem link"}</p>
              </div>
              <div className="promotion-message-actions">
                <button type="button" onClick={() => void move(index, -1)} disabled={pending || index === 0} aria-label={`Mover ${message.message_text} para cima`}><ArrowUp /></button>
                <button type="button" onClick={() => void move(index, 1)} disabled={pending || index === messages.length - 1} aria-label={`Mover ${message.message_text} para baixo`}><ArrowDown /></button>
                <button type="button" onClick={() => setDraft(messageDraft(message))} disabled={pending} aria-label={`Editar ${message.message_text}`}><Pencil /></button>
                <button type="button" onClick={() => void toggle(message)} disabled={pending} aria-label={`${message.active ? "Desativar" : "Ativar"} ${message.message_text}`}><Power /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
