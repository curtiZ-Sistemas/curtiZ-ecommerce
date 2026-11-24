"use client";

import { formatBRL } from "@curtiz/domain";
import { useState, type FormEvent } from "react";
import { InvoiceActions } from "./invoice-actions";

type Row = Record<string, unknown>;
const field = (row: Row,key: string) => typeof row[key] === "string" ? row[key] : "";
function requestedPairs(row: Row): [string,number][] {
  const selection = row.requestedPairs;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return [];
  return Object.entries(selection as Row).filter((entry): entry is [string,number] =>
    typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1]>0);
}
function DeliveryAddress({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Row;
  const postalCode = field(address,"postalCode").replace(/\D/gu,"");
  const street = [field(address,"street"),field(address,"number")].filter(Boolean).join(", ");
  const lines = [
    field(address,"name") && `Destinatário: ${field(address,"name")}`,
    street && `Endereço: ${[street,field(address,"complement")].filter(Boolean).join(" · ")}`,
    field(address,"district") && `Bairro: ${field(address,"district")}`,
    (field(address,"city") || field(address,"state")) && `Cidade: ${[field(address,"city"),field(address,"state")].filter(Boolean).join("/")}`,
    postalCode && `CEP: ${postalCode.length === 8 ? `${postalCode.slice(0,5)}-${postalCode.slice(5)}` : postalCode}`
  ].filter(Boolean);
  const phone = field(address,"phone").trim();
  const dial = phone.replace(/[^\d+]/gu,"");
  return lines.length || phone ? <div aria-label="Endereço de entrega">
    <strong>Entregar em</strong>
    {lines.map(line => <p key={line}>{line}</p>)}
    {phone && dial.replace("+","").length >= 8 ? <p>Telefone: <a href={`tel:${dial}`}>{phone}</a></p>
      : phone ? <p>Telefone: {phone}</p> : null}
  </div> : null;
}
const states: Record<string,string> = {
  requested: "Solicitada", approved: "Aprovada", received: "Aguardando validação do XML",
  verified: "XML validado", refund_pending: "Estorno em andamento", completed: "Concluída", rejected: "Recusada"
};
const invoiceErrors: Record<string,string> = {
  buyer_cnpj_required: "O comprador não tem CNPJ cadastrado.",
  buyer_registration_required: "O comprador não tem inscrição estadual cadastrada.",
  payment_method_required: "Forma de pagamento do Bling não configurada.",
  invoice_recipient_mismatch: "Os dados do destinatário no Bling não conferem com o pedido.",
  kit_fiscal_clearance_failed: "A conferência fiscal do pedido não passou.",
  duplicate_contact: "Há mais de um contato com este CNPJ no Bling.",
  duplicate_external_order: "Há mais de um pedido deste kit no Bling.",
  uncertain_write: "O Bling não confirmou a gravação.",
  unexpected_error: "Falha inesperada na emissão."
};
const paymentMethods: Record<string,string> = { pix: "Pix", debit_card: "Débito", credit_card: "Crédito", cash: "Dinheiro" };
const pointStates: Record<string,string> = {
  created: "Enviado ao terminal", at_terminal: "Aguardando no terminal", processed: "Recebimento confirmado",
  failed: "Pagamento recusado", expired: "Cobrança expirada", canceled: "Cobrança cancelada",
  refunded: "Estornado", action_required: "Conferir diretamente no terminal"
};

export function RepresentativeKitOperations({ mode, canReview, canInspect, canRefund, canPrint }: {
  mode: "fiscal" | "returns" | "collection"; canReview?: boolean; canInspect?: boolean; canRefund?: boolean; canPrint?: boolean;
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
  async function collectionAction(orderId: string, operation: string, evidence?: FormDataEntryValue | null) {
    setBusy(true);
    setError("");
    try {
      const action = ["launch","refresh","cancel"].includes(operation) ? "point" : "collection";
      const response = await fetch("/api/operations/representative-kits", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, orderId, operation, ...(action === "collection" ? { evidence } : {}) })
      });
      if (!response.ok) throw new Error("collection_unavailable");
      await readQueue();
    } catch {
      setError("Não foi possível concluir a operação. Atualize a fila antes de tentar novamente.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = submitter instanceof HTMLButtonElement ? submitter.value : "";
    const pairs = requestedPairs(row);
    const body = mode === "fiscal"
      ? action === "retry_auto_invoice"
        ? { action, orderId: field(row,"orderId") }
      : action === "submit_manual_invoice"
        ? { action, orderId: field(row,"orderId"), invoiceId: Number(form.get("invoiceId")), invoiceKey: form.get("invoiceKey") }
        : { action: "approve_invoice", orderId: field(row,"orderId"), hash: field(row,"draftHash"), evidence: form.get("evidence") }
      : action === "register_undelivered_return"
        ? { action, orderId: field(row,"orderId"), invoiceId: Number(form.get("invoiceId")), invoiceKey: form.get("invoiceKey"),
          restockQuantity: Number(form.get("restockQuantity")), evidence: form.get("evidence") }
      : action === "schedule_cash_delivery"
        ? { action, orderId: field(row,"orderId"), deliveryOn: form.get("deliveryOn") }
      : action === "confirm_mdfe"
        ? { action, orderId: field(row,"orderId"), accessKey: form.get("accessKey"),
          protocol: form.get("protocol"), evidence: form.get("evidence") }
      : { action, returnId: field(row,"id"),
        ...(action === "collection_refund" && row.collectionMethod === "cash" ? { cashEvidence: form.get("cashEvidence") } : {}),
        ...(action === "approve" || action === "reject" ? { instructions: form.get("instructions") } : {}),
        ...(action === "schedule_pickup" ? { pickupDate: form.get("pickupDate") } : {}),
        ...(action === "confirm_pickup" ? { pickupReference: form.get("pickupReference") } : {}),
        ...(action === "receive" ? { invoiceId: Number(form.get("invoiceId")), invoiceKey: form.get("invoiceKey"),
          documentOrigin: form.get("documentOrigin"), restockQuantity: Number(form.get("restockQuantity")),
          ...(pairs.length ? { restockPairs: Object.fromEntries(pairs.map(([sku]): [string, number] =>
            [sku,Number(form.get(`restock-${sku}`))]).filter(([,quantity]) => quantity > 0)) } : {}),
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
    <h2>{mode === "fiscal" ? "Notas fiscais dos kits MG" : mode === "collection" ? "Entregas de kits MG" : "Devoluções de kits MG"}</h2>
    <button type="button" disabled={busy} onClick={() => void load()}>{rows ? "Atualizar fila" : "Consultar fila"}</button>
    {error && <p role="alert">{error}</p>}
    {rows?.length === 0 && <p role="status">Nenhum registro nesta fila.</p>}
    {rows?.map(row => {
      const state = field(row,"state");
      const pairs = requestedPairs(row);
      return <article key={field(row,mode === "returns" ? "id" : "orderId")} className="op-surface">
        <h3>{field(row,"productName")}</h3>
        {pairs.length ? <ul>{pairs.map(([sku,quantity]) =>
          <li key={sku}>{sku} · {quantity} {quantity === 1 ? "par" : "pares"}</li>)}</ul>
          : <p>{field(row,"sku") ? `${field(row,"sku")} · ` : ""}{typeof row.quantity === "number" ? row.quantity : ""} kits</p>}
        {mode === "fiscal" ? <>
          <p>{row.invoiceAuthorized ? "NF-e emitida"
            : row.autoInvoiceStatus === "error" ? "NF-e com erro"
            : row.autoInvoiceStatus === "pending" ? typeof row.invoiceId === "number" ? "NF-e automática em emissão" : "NF-e automática pendente"
            : row.manualFiscal ? typeof row.manualInvoiceId === "number" ? "Aguardando validação da NF-e" : "Aguardando emissão fiscal"
            : row.draftApproved ? "Rascunho conferido" : typeof row.invoiceId === "number" ? "Aguardando revisão fiscal" : "Aguardando Bling"}</p>
          {typeof row.invoiceId === "number" && <p>NF-e no Bling {row.invoiceId}</p>}
          {row.invoiceAuthorized === true && field(row,"invoiceNumber") && <p>NF-e nº {field(row,"invoiceNumber")} · série 3</p>}
          {row.invoiceAuthorized === true && field(row,"invoiceKey") && <p>Chave de acesso {field(row,"invoiceKey")}</p>}
          <InvoiceActions authorized={row.invoiceAuthorized === true} blingInvoiceId={typeof row.invoiceId === "number" ? row.invoiceId : null}
            pdfUrl={`/api/operations/representative-kits/invoice-pdf?orderId=${encodeURIComponent(field(row,"orderId"))}`}
            label={field(row,"invoiceNumber") ? `NF-e nº ${field(row,"invoiceNumber")}` : "NF-e"} />
          {row.autoInvoiceStatus === "error" && !row.invoiceAuthorized && <>
            <p role="alert">Motivo: {invoiceErrors[field(row,"autoInvoiceError")] ?? "Falha na emissão automática."}</p>
            {!row.cancellationRequested && typeof row.manualInvoiceId !== "number" && <form onSubmit={event => void submit(event,row)}>
              <button type="submit" value="retry_auto_invoice" disabled={busy}>Reemitir</button>
            </form>}
          </>}
          {canPrint && row.invoiceAuthorized === true && !row.ownDelivery && !row.collectionMethod && ["label_created","dispatched","in_transit","delayed"].includes(field(row,"shipmentStatus"))
            && <button type="button" disabled={busy} onClick={() => void prepareLabel(field(row,"orderId"))}>Preparar impressão da etiqueta</button>}
          {label?.orderId === field(row,"orderId") && <a href={label.url} target="_blank" rel="noreferrer">Abrir etiqueta no Melhor Envio</a>}
          {row.cancellationRequested === true && <p>Cancelamento solicitado</p>}
          {row.manualFiscal === true && ["paid","awaiting_receipt"].includes(state) && !row.invoiceAuthorized && !row.cancellationRequested && <form onSubmit={event => void submit(event,row)}>
            <p>{row.autoInvoiceStatus === "error" ? "Se preferir, emita a NF-e manualmente no Bling. " : ""}Importe no Bling o XML autorizado antes de informar o ID e a chave.</p>
            <label>ID da NF-e no Bling <input required name="invoiceId" type="number" min={1} /></label>
            <label>Chave da NF-e série 003 <input required name="invoiceKey" inputMode="numeric" pattern="31[0-9]{18}55003[0-9]{19}" maxLength={44} /></label>
            <button type="submit" value="submit_manual_invoice" disabled={busy}>Enviar NF-e para validação</button>
          </form>}
          {field(row,"draftHash") && !row.draftApproved && row.autoInvoiceStatus == null && !row.invoiceAuthorized && !row.cancellationRequested && <form onSubmit={event => void submit(event,row)}>
            <label>Referência da conferência fiscal <input required name="evidence" minLength={10} maxLength={200} /></label>
            <button type="submit" disabled={busy}>Aprovar rascunho revisado</button>
          </form>}
        </> : mode === "collection" ? <CollectionControls row={row} busy={busy} run={collectionAction}
          submitProof={event => void submit(event,row)} /> : <>
          <p>{states[state] ?? "Em análise"}</p>
          <p>{field(row,"reason")}</p>
          {state === "approved" && <DeliveryAddress value={row.deliveryAddress} />}
          {typeof row.refundInCents === "number" && <p>Estorno {formatBRL(row.refundInCents)}</p>}
          {state === "requested" && canReview && <form onSubmit={event => void submit(event,row)}>
            <label>Orientações para o comprador <input name="instructions" required minLength={5} maxLength={500} /></label>
            <button type="submit" value="approve" disabled={busy}>Aprovar devolução</button>
            <button type="submit" value="reject" disabled={busy}>Recusar devolução</button>
          </form>}
          {row.ownDelivery === true && state === "approved" && canInspect && !row.pickedUp && <>
            <form onSubmit={event => void submit(event,row)}>
              <label>Data da retirada <input type="date" name="pickupDate" required defaultValue={field(row,"pickupOn")} /></label>
              <button type="submit" value="schedule_pickup" disabled={busy}>Agendar retirada</button>
            </form>
            {row.pickupOn && <form onSubmit={event => void submit(event,row)}>
              <label>Referência da retirada <input name="pickupReference" required minLength={10} maxLength={200} /></label>
              <button type="submit" value="confirm_pickup" disabled={busy}>Confirmar retirada</button>
            </form>}
          </>}
          {state === "approved" && canInspect && (!row.ownDelivery || row.pickedUp) && <form onSubmit={event => void submit(event,row)}>
            <label>Documento fiscal
              <select name="documentOrigin" required defaultValue="">
                <option value="" disabled>Selecione</option><option value="buyer_outflow">NF-e emitida pelo comprador</option>
                <option value="own_inflow">NF-e própria de entrada</option>
              </select>
            </label>
            <label>ID no Bling <input required name="invoiceId" type="number" min="1" /></label>
            <label>Chave da NF-e de devolução <input required name="invoiceKey" pattern="31[0-9]{42}" maxLength={44} inputMode="numeric" /></label>
            {pairs.length ? <fieldset>
              <legend>Pares em condição de revenda</legend>
              {pairs.map(([sku,quantity]) => <label key={sku}>{sku}
                <input name={`restock-${sku}`} type="number" min={0} max={quantity} defaultValue={0} required />
              </label>)}
            </fieldset> : <label>Kits em condição de revenda
              <input required name="restockQuantity" type="number" min="0" max={typeof row.quantity === "number" ? row.quantity : 99} />
            </label>}
            <label>Estorno em centavos <input required name="refundInCents" type="number" min="1" /></label>
            <label>Referência da inspeção <input required name="inspectionReference" minLength={10} maxLength={200} /></label>
            <button type="submit" value="receive" disabled={busy}>Registrar recebimento</button>
          </form>}
          {state === "verified" && canRefund && <form onSubmit={event => void submit(event,row)}>
            {row.collectionMethod === "cash"
              ? <button type="submit" value="refund" disabled={busy}>Autorizar devolução em dinheiro</button>
              : row.refundPrepared
                ? row.canConfirmRefund ? <button type="submit" value="refund" disabled={busy}>Confirmar estorno no Mercado Pago</button>
                  : <p>Aguardando confirmação de outro responsável.</p>
                : <button type="submit" value="prepare_refund" disabled={busy}>Solicitar estorno no Mercado Pago</button>}
          </form>}
          {state === "refund_pending" && canRefund && field(row,"collectionMethod") && <form onSubmit={event => void submit(event,row)}>
            {row.collectionMethod === "cash" && <label>Comprovante da devolução em dinheiro
              <input name="cashEvidence" required minLength={10} maxLength={200} />
            </label>}
            <button type="submit" value="collection_refund" disabled={busy}>
              {row.collectionMethod === "cash" ? "Confirmar devolução em dinheiro" : "Enviar ou conciliar estorno no Point"}
            </button>
          </form>}
        </>}
      </article>;
    })}
  </section>;
}

function CollectionControls({ row, busy, run, submitProof }: { row: Row; busy: boolean;
  submitProof: (event: FormEvent<HTMLFormElement>) => void;
  run: (orderId: string, operation: string, evidence?: FormDataEntryValue | null) => Promise<void> }) {
  const orderId = field(row,"orderId");
  const method = field(row,"collectionMethod");
  const shipment = field(row,"shipmentStatus");
  const pointStatus = field(row,"pointStatus");
  const awaitingReceipt = field(row,"state") === "awaiting_receipt";
  const paid = field(row,"state") === "paid";
  const dispatched = shipment === "dispatched";
  const delivered = shipment === "delivered";
  const canConfirmDelivery = dispatched && (awaitingReceipt || paid) && !row.cancellationRequested && row.invoiceAuthorized === true;
  const canConfirmCash = awaitingReceipt && method === "cash" && (dispatched || delivered) && !row.cancellationRequested;
  const canReportFailure = (awaitingReceipt || paid && !method) && dispatched && !row.cancellationRequested;
  const waitingTerminal = row.pointStarted === true && !["failed","expired","canceled"].includes(pointStatus);
  const operation = (awaitingReceipt || paid) && !row.cancellationRequested && !row.undeliveredReturnRecorded
    ? !dispatched && !delivered && row.invoiceAuthorized === true ? "dispatch" : null
    : awaitingReceipt && shipment === "delayed" && row.invoiceCancelled ? "returned_unpaid" : null;
  const canDispatch = row.mdfeRequired === false || row.mdfeVerified === true;
  const awaitingMdfe = operation === "dispatch" && !canDispatch;
  const canCancelBeforeDispatch = operation === "dispatch" && awaitingReceipt && shipment !== "delayed";
  const collectionDueOn = field(row,"collectionDueOn");

  return <>
    <DeliveryAddress value={row.deliveryAddress} />
    <p>{paymentMethods[method] ?? "Pix antecipado"}{typeof row.amountInCents === "number" && ` · ${formatBRL(row.amountInCents)}`}</p>
    {typeof row.cashTenderedInCents === "number" && typeof row.cashChangeInCents === "number"
      && <p>Valor informado {formatBRL(row.cashTenderedInCents)} · {row.cashChangeInCents ? `Troco ${formatBRL(row.cashChangeInCents)}` : "Sem troco"}</p>}
    <p role="status">{delivered && paid ? "Pedido concluído" : delivered ? "Entrega confirmada"
      : dispatched ? "Em entrega" : shipment === "delayed" ? "Entrega pendente"
        : awaitingMdfe ? "Aguardando conferência do MDF-e"
          : row.invoiceAuthorized ? "Pronto para entrega"
            : row.canScheduleCash === true && !collectionDueOn ? "Aguardando agendamento da entrega"
              : "Aguardando NF-e autorizada"}</p>
    {row.canScheduleCash === true ? <form onSubmit={submitProof}>
      <label>Data da entrega <input name="deliveryOn" type="date" defaultValue={collectionDueOn} required /></label>
      <button type="submit" value="schedule_cash_delivery" disabled={busy}>Salvar data da entrega</button>
    </form> : collectionDueOn && <p>Entrega agendada para {collectionDueOn.split("-").reverse().join("/")}</p>}
    {awaitingMdfe && row.mdfeRequired === true && <form onSubmit={submitProof}>
      <p>Na SEFAZ, confira se o MDF-e está autorizado e inclui a NF-e deste pedido, a rota e o veículo da saída.</p>
      <label>Chave do MDF-e <input name="accessKey" required inputMode="numeric" pattern="31[0-9]{18}58[0-9]{22}" maxLength={44} /></label>
      <label>Protocolo de autorização <input name="protocol" required inputMode="numeric" pattern="[0-9]{15}" maxLength={15} /></label>
      <label>Referência da conferência na SEFAZ <input name="evidence" required minLength={10} maxLength={200} /></label>
      <button type="submit" value="confirm_mdfe" disabled={busy}>Registrar MDF-e conferido</button>
    </form>}
    {shipment === "delayed" && (awaitingReceipt || paid) && row.invoiceAuthorized === true && !row.cancellationRequested && (
      row.undeliveredReturnRecorded ? <p>Retorno físico registrado. Aguardando validação do XML.</p> : <form onSubmit={submitProof}>
        <label>ID no Bling da NF-e de entrada <input name="invoiceId" type="number" min={1} required /></label>
        <label>Chave da NF-e série 004 <input name="invoiceKey" inputMode="numeric" pattern="31[0-9]{20}004[0-9]{19}" maxLength={44} required /></label>
        <label>Kits em condição de revenda <input name="restockQuantity" type="number" min={awaitingReceipt && typeof row.quantity === "number" ? row.quantity : 0}
          max={typeof row.quantity === "number" ? row.quantity : 99} required /></label>
        <label>Referência da inspeção do retorno <input name="evidence" minLength={10} maxLength={200} required /></label>
        <button type="submit" value="register_undelivered_return" disabled={busy}>Registrar retorno físico sem entrega</button>
      </form>
    )}
    <p>{paid ? "Pagamento confirmado" : pointStatus ? pointStates[pointStatus] : "Pagamento pendente"}</p>
    {awaitingReceipt && (dispatched || delivered) && method !== "cash" && !row.cancellationRequested && (
      <div>
        {(!waitingTerminal || row.pointLinked !== true) && <button type="button" disabled={busy}
          onClick={() => void run(orderId,"launch")}>Enviar cobrança ao terminal</button>}
        {row.pointLinked === true && <button type="button" disabled={busy}
          onClick={() => void run(orderId,"refresh")}>Confirmar pagamento</button>}
        {waitingTerminal && row.pointLinked === true && <button type="button" disabled={busy}
          onClick={() => void run(orderId,"cancel")}>Cancelar cobrança no terminal</button>}
      </div>
    )}
    {((operation && !awaitingMdfe) || canCancelBeforeDispatch
      || canConfirmDelivery || canConfirmCash || canReportFailure && !waitingTerminal) && (
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const submitter = event.nativeEvent.submitter;
        if (submitter instanceof HTMLButtonElement) void run(orderId,submitter.value,form.get("evidence"));
      }}>
        <label>Referência da operação <input name="evidence" required minLength={10} maxLength={200} /></label>
        {operation && !awaitingMdfe && <button type="submit" value={operation} disabled={busy}>
          {operation === "dispatch" ? "Registrar saída para entrega"
            : "Confirmar retorno ao estoque"}
        </button>}
        {canConfirmDelivery && <button type="submit" value="confirm_delivery" disabled={busy}>Confirmar entrega</button>}
        {canConfirmCash && <button type="submit" value="cash_received" disabled={busy}>Confirmar pagamento em dinheiro</button>}
        {canCancelBeforeDispatch
          && <button type="submit" value="cancel_before_dispatch" disabled={busy}>Solicitar cancelamento antes da entrega</button>}
        {canReportFailure && !waitingTerminal
          && <button type="submit" value="delivery_failed" disabled={busy}>Registrar entrega sem recebimento</button>}
      </form>
    )}
  </>;
}
