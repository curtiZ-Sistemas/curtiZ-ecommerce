import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type Application,
  applicationActionsFor,
  ApplicationsTable,
  recordsLabel,
  ReviewDialog
} from "./representative-application-table";

const application = (status: string, id = status): Application => ({
  id,
  publicCode: `SOL-${id.toUpperCase()}`,
  status,
  updatedAt: "2026-11-20T12:00:00Z"
});

const labels = (status: string, role = "administracao", canReview = true) =>
  applicationActionsFor(status, role, canReview).map((action) => action.label);

describe("ações de solicitações de representantes", () => {
  it("oferece as decisões que o servidor aceita em cada situação", () => {
    expect(labels("submitted")).toEqual(["Iniciar análise", "Pedir ajuste", "Recusar"]);
    expect(labels("under_review")).toEqual(["Aprovar", "Pedir ajuste", "Recusar"]);
    expect(labels("documents_pending")).toEqual(["Retomar análise", "Recusar"]);
    expect(labels("rejected")).toEqual([]);
  });

  it("não oferece ação sem a permissão representatives.manage", () => {
    for (const status of ["submitted", "under_review", "documents_pending", "approved", "suspended"]) {
      expect(labels(status, "gerencia", false)).toEqual([]);
    }
  });

  it("leva a gerência ao cadastro de aprovadas e suspensas, sem oferecer suspender aqui", () => {
    expect(labels("approved", "gerencia")).toEqual(["Ver cadastro"]);
    expect(labels("suspended", "gerencia")).toEqual(["Ver cadastro"]);
    expect(labels("approved", "administracao")).toEqual([]);
  });

  it("oculta a coluna Ações quando nenhuma linha tem ação", () => {
    const html = renderToStaticMarkup(
      <ApplicationsTable items={[application("approved"), application("rejected")]} role="administracao" canReview onDecision={() => undefined} />
    );
    expect(html).toContain("Solicitação");
    expect(html).not.toContain("Ações");
  });

  it("mostra a coluna Ações com botões reais e sem célula vazia", () => {
    const html = renderToStaticMarkup(
      <ApplicationsTable items={[application("under_review"), application("rejected")]} role="administracao" canReview onDecision={() => undefined} />
    );
    expect(html).toContain("Ações");
    expect(html).toContain("Aprovar");
    expect(html).toContain("Recusar");
    expect(html).toContain("Pedir ajuste");
    expect(html).toContain("Sem ações disponíveis");
  });

  it("mostra Ver cadastro para aprovada na gerência e esconde sem permissão", () => {
    const withPermission = renderToStaticMarkup(
      <ApplicationsTable items={[application("approved")]} role="gerencia" canReview onDecision={() => undefined} />
    );
    expect(withPermission).toContain("Ver cadastro");
    expect(withPermission).toContain('href="/gerencia/representantes"');
    const without = renderToStaticMarkup(
      <ApplicationsTable items={[application("approved")]} role="gerencia" canReview={false} onDecision={() => undefined} />
    );
    expect(without).not.toContain("Ver cadastro");
    expect(without).not.toContain("Ações");
  });

  it("pluraliza o contador de registros", () => {
    expect(recordsLabel(0)).toBe("0 registros");
    expect(recordsLabel(1)).toBe("1 registro");
    expect(recordsLabel(2)).toBe("2 registros");
  });

  it("mostra o erro dentro do modal e o estado Salvando…", () => {
    const failed = renderToStaticMarkup(
      <ReviewDialog publicCode="SOL-1" decision="reject" saving={false} error="Decisão não permitida." onCancel={() => undefined} onConfirm={() => undefined} />
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Decisão não permitida.");
    expect(failed).toContain("Motivo da recusa");
    const saving = renderToStaticMarkup(
      <ReviewDialog publicCode="SOL-1" decision="approve" saving error="" onCancel={() => undefined} onConfirm={() => undefined} />
    );
    expect(saving).toContain("Salvando…");
    expect(saving).not.toContain('role="alert"');
  });
});
