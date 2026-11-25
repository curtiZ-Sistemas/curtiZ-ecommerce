"use client";

import { Download, Eye, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

/**
 * Página da NF-e no Bling (abre direto a edição da nota pelo ID salvo). É o padrão do Bling
 * para notas fiscais: https://www.bling.com.br/notas.fiscais.php#edit/{id}.
 */
export const blingInvoiceEditUrl = (invoiceId: number) =>
  `https://www.bling.com.br/notas.fiscais.php#edit/${invoiceId}`;

export const invoicePdfDownloadUrl = (pdfUrl: string) => `${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}download=1`;

export const PDF_UNAVAILABLE = "PDF indisponível no Bling";

/** Decide o que fazer com uma tecla dentro do modal: fechar ou manter o foco preso entre os controles. */
export function dialogKeyAction(key: string, shiftKey: boolean, activeIndex: number, count: number):
  "close" | { focus: number } | null {
  if (key === "Escape") return "close";
  if (key !== "Tab" || count < 1) return null;
  if (shiftKey) return { focus: activeIndex <= 0 ? count - 1 : activeIndex - 1 };
  return { focus: activeIndex < 0 || activeIndex >= count - 1 ? 0 : activeIndex + 1 };
}

async function fetchPdf(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin", headers: { accept: "application/pdf" } });
  const blob = response.ok ? await response.blob() : null;
  if (!blob || blob.type !== "application/pdf") throw new Error("pdf_unavailable");
  return blob;
}

export function InvoicePreviewDialog({ title, pdfUrl, loading, error, onDownload, onFrameLoad, onClose, onRetry, onFrameError }: {
  title: string; pdfUrl: string; loading: boolean; error: string;
  onDownload: () => void; onFrameLoad: (frame: HTMLIFrameElement) => void; onClose: () => void;
  onRetry?: () => void; onFrameError?: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("[data-invoice-close]")?.focus();
    return () => { document.body.style.overflow = priorOverflow; };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled])") ?? []);
    const action = dialogKeyAction(event.key, event.shiftKey, items.indexOf(document.activeElement as HTMLElement), items.length);
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "close") onClose(); else items[action.focus]?.focus();
  };
  return <div className="admin-modal-backdrop invoice-preview-backdrop" role="presentation"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="invoice-preview" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <div className="invoice-preview-tools">
          <button className="invoice-action" type="button" aria-label="Baixar DANFE" title="Baixar DANFE" disabled={loading || !!error} onClick={onDownload}>
            <Download aria-hidden="true" /></button>
          <button className="invoice-action" type="button" data-invoice-close aria-label="Fechar" title="Fechar" onClick={onClose}>
            <X aria-hidden="true" /></button>
        </div>
      </header>
      <div className="invoice-preview-body">
        {loading && !error && <p role="status">Carregando DANFE…</p>}
        {error && <div className="invoice-preview-error"><p role="alert">{error}</p>
          {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>Tentar novamente</button>}
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">Abrir em outra aba</a>
        </div>}
        {!error && <iframe title={title} src={pdfUrl} onLoad={event => onFrameLoad(event.currentTarget)} onError={onFrameError} />}
      </div>
    </section>
  </div>;
}

/** Download, visualização e edição no Bling de uma NF-e autorizada. Não exibe nada antes da autorização. */
export function InvoiceActions({ authorized, blingInvoiceId, pdfUrl, label, compact = false, externalReported = false }: {
  authorized: boolean; blingInvoiceId: number | null | undefined; pdfUrl: string; label: string;
  compact?: boolean; externalReported?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const eye = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !loading) return;
    const timer = window.setTimeout(() => { setLoading(false); setError("Não foi possível carregar o DANFE. Tente novamente."); }, 25_000);
    return () => window.clearTimeout(timer);
  }, [open, loading]);
  if ((!authorized && !externalReported) || typeof blingInvoiceId !== "number" || !Number.isSafeInteger(blingInvoiceId) || blingInvoiceId <= 0) return null;
  const fileName = `danfe-${label.replace(/\D/gu, "") || blingInvoiceId}.pdf`;

  async function download() {
    setError("");
    try {
      const href = URL.createObjectURL(await fetchPdf(invoicePdfDownloadUrl(pdfUrl)));
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { setError(PDF_UNAVAILABLE); }
  }
  // A resposta de erro da rota é JSON; só um PDF carregado no quadro conta como sucesso.
  function frameLoaded(frame: HTMLIFrameElement) {
    setLoading(false);
    // Chromium's native PDF viewer can expose a blank HTML document or no
    // contentDocument at all. Only explicit error documents are failures.
    try {
      const doc = frame.contentDocument;
      if (doc && (doc.contentType === "application/json" || doc.contentType === "text/plain" ||
        (doc.contentType === "text/html" && /indisponível|acesso negado|não foi possível/i.test(doc.body?.textContent ?? ""))))
        setError(PDF_UNAVAILABLE);
    } catch { /* The browser may isolate its native PDF viewer. */ }
  }
  function view() {
    setError("");
    setLoading(true);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setError("");
    setTimeout(() => eye.current?.focus(), 0);
  }

  return <div className="invoice-actions" role="group" aria-label={`Ações da ${label}`}>
    {!compact && !externalReported && <button className="invoice-action" type="button" aria-label="Baixar DANFE" title="Baixar DANFE" onClick={() => void download()}>
      <Download aria-hidden="true" /></button>}
    <button ref={eye} className="invoice-action" type="button" aria-label="Ver nota" title="Ver nota" aria-haspopup="dialog" onClick={view}>
      <Eye aria-hidden="true" /></button>
    {!compact && !externalReported && <a className="invoice-action" href={blingInvoiceEditUrl(blingInvoiceId)} target="_blank" rel="noopener noreferrer"
      aria-label="Editar no Bling" title="Editar no Bling"><Pencil aria-hidden="true" /></a>}
    {error && !open && <span role="alert" className="invoice-actions-error">{error}</span>}
    {open && createPortal(<InvoicePreviewDialog title={`DANFE · ${label}`} pdfUrl={pdfUrl} loading={loading} error={error}
      onDownload={() => void download()} onFrameLoad={frameLoaded} onClose={close} onRetry={view}
      onFrameError={() => { setLoading(false); setError(PDF_UNAVAILABLE); }} />, document.body)}
  </div>;
}
