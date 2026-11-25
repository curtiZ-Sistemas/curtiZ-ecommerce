import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  blingInvoiceEditUrl, dialogKeyAction, InvoiceActions, InvoicePreviewDialog, invoicePdfDownloadUrl
} from "./invoice-actions";

const pdfUrl = "/api/operations/representative-kits/invoice-pdf?orderId=abc";
const render = (authorized: boolean, id: number | null = 301) =>
  renderToStaticMarkup(<InvoiceActions authorized={authorized} blingInvoiceId={id} pdfUrl={pdfUrl} label="NF-e nº 1" />);
const noop = () => undefined;

describe("ações da NF-e", () => {
  it("mostra download, olho e lápis, nessa ordem, só com nota autorizada e ID do Bling", () => {
    const html = render(true);
    const order = ["Baixar DANFE", "Ver nota", "Editar no Bling"].map(name => html.indexOf(`aria-label="${name}"`));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("href=\"https://www.bling.com.br/notas.fiscais.php#edit/301\"");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("rel=\"noopener noreferrer\"");
    expect(html).not.toContain("role=\"dialog\"");
    expect(render(false)).toBe("");
    expect(render(true, null)).toBe("");
  });

  it("monta as URLs de edição e de download", () => {
    expect(blingInvoiceEditUrl(9)).toBe("https://www.bling.com.br/notas.fiscais.php#edit/9");
    expect(invoicePdfDownloadUrl(pdfUrl)).toBe(`${pdfUrl}&download=1`);
  });

  it("descreve o modal como diálogo acessível com download à esquerda do X", () => {
    const html = renderToStaticMarkup(<InvoicePreviewDialog title="DANFE · NF-e nº 1" pdfUrl={pdfUrl} loading={false} error=""
      onDownload={noop} onFrameLoad={noop} onClose={noop} />);
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("<iframe");
    expect(html.indexOf("aria-label=\"Baixar DANFE\"")).toBeLessThan(html.indexOf("aria-label=\"Fechar\""));
    const unavailable = renderToStaticMarkup(<InvoicePreviewDialog title="t" pdfUrl={pdfUrl} loading={false}
      error="PDF indisponível no Bling" onDownload={noop} onFrameLoad={noop} onClose={noop} />);
    expect(unavailable).toContain("PDF indisponível no Bling");
    expect(unavailable).not.toContain("<iframe");
  });

  it("fecha com Esc e mantém o foco preso com Tab", () => {
    expect(dialogKeyAction("Escape", false, 0, 2)).toBe("close");
    expect(dialogKeyAction("Tab", false, 1, 2)).toEqual({ focus: 0 });
    expect(dialogKeyAction("Tab", true, 0, 2)).toEqual({ focus: 1 });
    expect(dialogKeyAction("Tab", false, 0, 2)).toEqual({ focus: 1 });
    expect(dialogKeyAction("a", false, 0, 2)).toBeNull();
  });
});


it("mostra apenas o olho em uma linha compacta e permite documento externo com ID", () => {
  const html = renderToStaticMarkup(<InvoiceActions compact externalReported authorized={false} blingInvoiceId={77} pdfUrl={pdfUrl} label="NF-e nº 3" />);
  expect(html).toContain('aria-label="Ver nota"');
  expect(html).not.toContain('aria-label="Editar no Bling"');
  expect(html).not.toContain('aria-label="Baixar DANFE"');
  expect(renderToStaticMarkup(<InvoiceActions compact externalReported authorized={false} blingInvoiceId={null} pdfUrl={pdfUrl} label="NF-e nº 3" />)).toBe("");
});
