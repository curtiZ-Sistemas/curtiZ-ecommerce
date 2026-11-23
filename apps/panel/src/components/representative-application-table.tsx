"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

export type Application = {
  id: string;
  publicCode: string;
  fullName?: string;
  email?: string;
  status: string;
  updatedAt: string;
};

export type ReviewDecision = "start_review" | "request_documents" | "approve" | "reject";

export type ApplicationAction =
  | { kind: "decision"; decision: ReviewDecision; label: string; tone?: "approve" | "reject" }
  | { kind: "link"; href: string; label: string };

const decisionCopy: Record<ReviewDecision, { title: string; reasonLabel: string; confirm: string; hint: string }> = {
  start_review: {
    title: "Iniciar análise",
    reasonLabel: "Observação da análise",
    confirm: "Iniciar análise",
    hint: "A solicitação passa para a fila de análise."
  },
  request_documents: {
    title: "Pedir ajuste",
    reasonLabel: "O que a candidata precisa corrigir",
    confirm: "Pedir ajuste",
    hint: "A candidata é avisada e pode corrigir os dados enviados."
  },
  approve: {
    title: "Aprovar solicitação",
    reasonLabel: "Justificativa da aprovação",
    confirm: "Aprovar",
    hint: "A candidata passa a representante e aguarda o primeiro kit."
  },
  reject: {
    title: "Recusar solicitação",
    reasonLabel: "Motivo da recusa",
    confirm: "Recusar",
    hint: "A decisão fica registrada com este motivo e a candidata é avisada."
  }
};

export const reviewDecisionCopy = (decision: ReviewDecision) => decisionCopy[decision];

/**
 * Ações disponíveis por situação, limitadas ao que o servidor aceita
 * (review_representative_application) e à permissão representatives.manage.
 * Suspender e reativar o cadastro seguem em Gerência > Representantes, que usa o id do representante.
 */
export function applicationActionsFor(status: string, role: string, canReview: boolean): ApplicationAction[] {
  if (!canReview) return [];
  switch (status) {
    case "submitted":
      return [
        { kind: "decision", decision: "start_review", label: "Iniciar análise" },
        { kind: "decision", decision: "request_documents", label: "Pedir ajuste" },
        { kind: "decision", decision: "reject", label: "Recusar", tone: "reject" }
      ];
    case "under_review":
      return [
        { kind: "decision", decision: "approve", label: "Aprovar", tone: "approve" },
        { kind: "decision", decision: "request_documents", label: "Pedir ajuste" },
        { kind: "decision", decision: "reject", label: "Recusar", tone: "reject" }
      ];
    case "documents_pending":
      return [
        { kind: "decision", decision: "start_review", label: "Retomar análise" },
        { kind: "decision", decision: "reject", label: "Recusar", tone: "reject" }
      ];
    case "approved":
    case "suspended":
      return role === "gerencia" ? [{ kind: "link", href: "/gerencia/representantes", label: "Ver cadastro" }] : [];
    default:
      return [];
  }
}

export const recordsLabel = (count: number) => `${count} ${count === 1 ? "registro" : "registros"}`;

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 2) ?? ""}***@${domain ?? ""}`;
};

const statusLabel = (status: string) =>
  (
    {
      draft: "Rascunho",
      submitted: "Enviada",
      under_review: "Em análise",
      documents_pending: "Correção solicitada",
      approved: "Aprovada",
      rejected: "Rejeitada",
      suspended: "Suspensa",
      cancelled: "Cancelada"
    } as Record<string, string>
  )[status] ?? status;

export function ApplicationsTable({
  items,
  role,
  canReview,
  onDecision
}: {
  items: Application[];
  role: string;
  canReview: boolean;
  onDecision: (item: Application, decision: ReviewDecision) => void;
}) {
  const rows = items.map((item) => ({ item, actions: applicationActionsFor(item.status, role, canReview) }));
  // Sem nenhuma ação possível em qualquer linha, a coluna inteira some em vez de ficar vazia.
  const showActions = rows.some((row) => row.actions.length > 0);

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Solicitação</th>
            <th>Candidata</th>
            <th>Status</th>
            <th>Atualização</th>
            {showActions && <th>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, actions }) => (
            <tr key={item.id}>
              <td>
                <strong>{item.publicCode}</strong>
              </td>
              <td>
                {item.fullName ?? "Dados protegidos"}
                {item.email && <small>{maskEmail(item.email)}</small>}
              </td>
              <td>
                <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
              </td>
              <td>{new Intl.DateTimeFormat("pt-BR").format(new Date(item.updatedAt))}</td>
              {showActions && (
                <td>
                  <div className="review-actions">
                    {actions.length === 0 && <span aria-label="Sem ações disponíveis">—</span>}
                    {actions.map((action) =>
                      action.kind === "link" ? (
                        <Link key={action.label} href={action.href}>
                          {action.label}
                        </Link>
                      ) : (
                        <button
                          key={action.decision}
                          type="button"
                          className={action.tone}
                          onClick={() => onDecision(item, action.decision)}
                        >
                          {action.tone === "approve" && <Check />}
                          {action.tone === "reject" && <X />}
                          {action.label}
                        </button>
                      )
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewDialog({
  publicCode,
  decision,
  saving,
  error,
  onCancel,
  onConfirm
}: {
  publicCode: string;
  decision: ReviewDecision;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const copy = decisionCopy[decision];
  const [reason, setReason] = useState("");
  const savingRef = useRef(saving);
  savingRef.current = saving;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = reason.trim();
    if (saving || normalized.length < 3) return;
    onConfirm(normalized);
  };

  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className="admin-confirm panel-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
        <h2 id="review-dialog-title">
          {copy.title} · {publicCode}
        </h2>
        <p>{copy.hint}</p>
        <form className="panel-prompt-form" onSubmit={submit}>
          <label>
            <span>{copy.reasonLabel}</span>
            <textarea
              autoFocus
              rows={4}
              minLength={3}
              maxLength={1000}
              required
              disabled={saving}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && (
            <p className="admin-field-error" role="alert">
              {error}
            </p>
          )}
          <div>
            <button className="secondary-button" type="button" disabled={saving} onClick={onCancel}>
              Cancelar
            </button>
            <button
              className={decision === "reject" ? "danger-button" : "primary-button"}
              type="submit"
              disabled={saving || reason.trim().length < 3}
            >
              {saving ? (
                <>
                  <LoaderCircle className="spin" /> Salvando…
                </>
              ) : (
                copy.confirm
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
