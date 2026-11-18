"use client";

import { formatBRL } from "@curtiz/domain";
import { useState, type FormEvent } from "react";

type Row = Record<string, unknown>;
const field = (row: Row,key: string) => typeof row[key] === "string" ? row[key] : "";
const states: Record<string,string> = {
  requested: "Solicitada", approved: "Aprovada", received: "Aguardando validação do XML",
  verified: "XML validado", refund_pending: "Estorno em andamento", completed: "Concluída", rejected: "Recusada"
};

export function RepresentativeKitOperations({ mode, canReview, canInspect, canRefund, canPrint }: {
  mode: "fiscal" | "returns"; canReview?: boolean; canInspect?: boolean; canRefund?: boolean; canPrint?: boolean;
}) {
  const [rows,setRows] = useState<Row[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [label,setLabel] = useState<{ orderId: string; url: string } | null>(null);
  async function prepareLabel(orderId: string) {
    setBusy(true);
    setLabel(null);
    setError("");
    try {
      const response = await fetch("/api/operations/representative-kits", {
        method: "POST",headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "print_label",orderId })
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("url" in result)
        || typeof result.url !== "string" || new URL(result.url).origin !== "https://melhorenvio.com.br") {
        throw new Error("label_unavailable");
      }
      setLabel({ orderId,url: result.url });
    } catch { setError("Não foi possível preparar a impressão da etiqueta."); }
    finally { setBusy(false); }
  }
  async function readQueue() {
    const response = await fetch(`/api/operations/representative-kits?mode=${mode}`,{ cache: "no-store" });
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
      throw new Error("Não foi possível consultar a fila.");
    }
    setRows(result.rows.filter((row: unknown): row is Row => !!row && typeof row === "object" && !Array.isArray(row)));
  }
  async function load() {
    setBusy(true);
    setError("");
    try { await readQueue(); }
    catch { setError("Não foi possível consultar a fila."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const body = mode === "fiscal"
      ? { action: "approve_invoice", orderId: field(row,"orderId"), hash: field(row,"draftHash"), evidence: form.get("evidence") }
      : { action, returnId: field(row,"id"),
        ...(action === "approve" || action === "reject" ? { instructions: form.get("instructions") } : {}),
        ...(action === "receive" ? { invoiceId: Number(form.get("invoiceId")), invoiceKey: form.get("invoiceKey"),
          documentOrigin: form.get("documentOrigin"), restockQuantity: Number(form.get("restockQuantity")),
          refundInCents: Number(form.get("refundInCents")), inspectionReference: form.get("inspectionReference") } : {}) };
    try {
      const response = await fetch("/api/operations/representative-kits", {
        method: "POST",headers: { "content-type": "application/json" },body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error("mutation_failed");
      await readQueue();
    } catch { setError("Não foi possível atualizar a fila. Confira o estado e os dados do pedido."); }
    finally { setBusy(false); }
  }
  return <section className="op-surface" aria-busy={busy}>
    <h2>{mode === "fiscal" ? "Notas fiscais dos kits MG" : "Devoluções de kits MG"}</h2>
    <button type="button" disabled={busy} onClick={() => void load()}>{rows ? "Atualizar fila" : "Consultar fila"}</button>
    {error && <p role="alert">{error}</p>}
    {rows?.length === 0 && <p role="status">Nenhum registro nesta fila.</p>}
    {rows?.map(row => {
      const state = field(row,"state");
      return <article key={field(row,mode === "fiscal" ? "orderId" : "id")} className="op-surface">
        <h3>{field(row,"productName")}</h3>
        <p>{field(row,"sku")} · {typeof row.quantity === "number" ? row.quantity : ""} kits</p>
        {mode === "fiscal" ? <>
          <p>{row.invoiceAuthorized ? "NF-e autorizada"
            : row.draftApproved ? "Rascunho conferido" : typeof row.invoiceId === "number" ? "Aguardando revisão fiscal" : "Aguardando Bling"}</p>
          {typeof row.invoiceId === "number" && <p>NF-e no Bling {row.invoiceId}</p>}
          {canPrint && row.invoiceAuthorized === true && ["label_created","dispatched","in_transit","delayed"].includes(field(row,"shipmentStatus"))
            && <button type="button" disabled={busy} onClick={() => void prepareLabel(field(row,"orderId"))}>Preparar impressão da etiqueta</button>}
          {label?.orderId === field(row,"orderId") && <a href={label.url} target="_blank" rel="noreferrer">Abrir etiqueta no Melhor Envio</a>}
          {row.cancellationRequested === true && <p>Cancelamento solicitado</p>}
          {field(row,"draftHash") && !row.draftApproved && !row.invoiceAuthorized && !row.cancellationRequested && <form onSubmit={event => void submit(event,row)}>
            <label>Referência da conferência fiscal <input required name="evidence" minLength={10} maxLength={200} /></label>
            <button type="submit" disabled={busy}>Aprovar rascunho revisado</button>
          </form>}
        </> : <>
          <p>{states[state] ?? "Em análise"}</p>
          <p>{field(row,"reason")}</p>
          {typeof row.refundInCents === "number" && <p>Estorno {formatBRL(row.refundInCents)}</p>}
          {state === "requested" && canReview && <form onSubmit={event => void submit(event,row)}>
            <label>Orientações para o comprador <input name="instructions" required minLength={5} maxLength={500} /></label>
            <button type="submit" value="approve" disabled={busy}>Aprovar devolução</button>
            <button type="submit" value="reject" disabled={busy}>Recusar devolução</button>
          </form>}
          {state === "approved" && canInspect && <form onSubmit={event => void submit(event,row)}>
            <label>Documento fiscal
              <select name="documentOrigin" required defaultValue="">
                <option value="" disabled>Selecione</option><option value="buyer_outflow">NF-e emitida pelo comprador</option>
                <option value="own_inflow">NF-e própria de entrada</option>
              </select>
            </label>
            <label>ID no Bling <input required name="invoiceId" type="number" min="1" /></label>
            <label>Chave da NF-e de devolução <input required name="invoiceKey" pattern="31[0-9]{42}" maxLength={44} inputMode="numeric" /></label>
            <label>Kits em condição de revenda <input required name="restockQuantity" type="number" min="0" max={typeof row.quantity === "number" ? row.quantity : 99} /></label>
            <label>Estorno em centavos <input required name="refundInCents" type="number" min="1" /></label>
            <label>Referência da inspeção <input required name="inspectionReference" minLength={10} maxLength={200} /></label>
            <button type="submit" value="receive" disabled={busy}>Registrar recebimento</button>
          </form>}
          {state === "verified" && canRefund && <form onSubmit={event => void submit(event,row)}>
            <button type="submit" value="refund" disabled={busy}>Autorizar estorno</button>
          </form>}
        </>}
      </article>;
    })}
  </section>;
}
