"use client";

import { formatBRL, formatBRLInput, parseBRLToCents } from "@curtiz/domain";
import { Check, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatCep, formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj";
import { InvoiceActions } from "./invoice-actions";
import { lookupFiscalPostalCode, mergePostalAddress, type PostalLookupState } from "@/lib/fiscal-postal-code";

export type WholesaleTemplate = { code: string; label: string; available: number; unitPriceInCents: number; sizes: { size: string; pairs: number }[] };
export type WholesaleOffer = { kitId: string; name: string; description: string; templates: WholesaleTemplate[] };
export type WholesaleInvoice = {
  id: string; status: string; stage: string; kitName: string; templateLabel: string; quantity: number; totalInCents: number;
  paymentMethod: string; buyerName: string; buyerDocument: string; invoiceId: number | null; invoiceNumber: string | null;
  authorized: boolean; errorCode: string | null; canCancel: boolean; cancelPending?: boolean; createdAt: string;
};
export type WholesaleBuyer = {
  document: string; name: string; registration: string; postalCode: string; street: string; number: string;
  complement: string; district: string; city: string; state: string;
};
export type IssueEvent =
  | { type: "step"; step: string }
  | { type: "result"; status: string; code: string | null; invoice: WholesaleInvoice | null };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown) => typeof value === "string" ? value : "";

export function readOffers(value: unknown): WholesaleOffer[] {
  return (Array.isArray(value) ? value : []).flatMap(item => {
    const row = record(item);
    if (!row || !str(row.kitId) || !str(row.name) || !Array.isArray(row.templates)) return [];
    const templates = row.templates.flatMap((entry): WholesaleTemplate[] => {
      const t = record(entry);
      if (!t || !str(t.code) || typeof t.available !== "number" || typeof t.unitPriceInCents !== "number") return [];
      const sizes = (Array.isArray(t.sizes) ? t.sizes : []).flatMap(size => {
        const s = record(size);
        return s && str(s.size) && typeof s.pairs === "number" ? [{ size: s.size as string, pairs: s.pairs }] : [];
      });
      return [{ code: t.code as string, label: str(t.label), available: t.available, unitPriceInCents: t.unitPriceInCents, sizes }];
    });
    return [{ kitId: row.kitId as string, name: row.name as string, description: str(row.description), templates }];
  });
}

export function readInvoice(value: unknown): WholesaleInvoice | null {
  const row = record(value);
  if (!row || !str(row.id) || typeof row.quantity !== "number" || typeof row.totalInCents !== "number") return null;
  return {
    id: row.id as string, status: str(row.status), stage: str(row.stage), kitName: str(row.kitName), templateLabel: str(row.templateLabel),
    quantity: row.quantity, totalInCents: row.totalInCents, paymentMethod: str(row.paymentMethod), buyerName: str(row.buyerName),
    buyerDocument: str(row.buyerDocument), invoiceId: typeof row.invoiceId === "number" ? row.invoiceId : null,
    invoiceNumber: str(row.invoiceNumber) || null, authorized: row.authorized === true, errorCode: str(row.errorCode) || null,
    canCancel: row.canCancel === true, cancelPending: row.cancelPending === true, createdAt: str(row.createdAt)
  };
}

/** One line of the streamed answer of POST action "issue". */
export function parseIssueLine(line: string): IssueEvent | null {
  try {
    const value = record(JSON.parse(line));
    if (value?.type === "step" && typeof value.step === "string") return { type: "step", step: value.step };
    if (value?.type === "result" && typeof value.status === "string")
      return { type: "result", status: value.status, code: str(value.code) || null, invoice: readInvoice(value.invoice) };
  } catch { /* A broken line is ignored; the final state is read from the list. */ }
  return null;
}

export const issueSteps: [string, string][] = [
  ["contact", "Cliente no Bling"], ["sale", "Venda registrada"], ["draft", "Nota montada"],
  ["send", "Enviada à SEFAZ"], ["authorization", "Autorização"]
];

const reasons: Record<string, string> = {
  bling_not_production: "A emissão só envia ao Bling no sistema em produção. A nota ficou salva e nada foi enviado.",
  bling_order_sync_disabled: "O envio de pedidos ao Bling está desligado. A nota ficou salva; quando for ligado, use Tentar de novo.",
  bling_invoice_sync_disabled: "A criação da nota no Bling está desligada. A venda foi registrada no Bling e a nota ficou salva.",
  bling_send_disabled: "A nota está pronta como rascunho no Bling. O envio à SEFAZ está desligado: o envio precisa ser habilitado pela administração. Depois, use Tentar de novo.",
  awaiting_authorization: "A nota foi enviada, mas a SEFAZ ainda não respondeu. Verifique de novo em instantes.",
  payment_method_required: "A forma de pagamento (Pix ou Dinheiro) não está configurada no Bling.",
  kit_fiscal_clearance_failed: "A conferência fiscal não passou. Confira os dados do cliente e o cadastro fiscal do produto.",
  wholesale_grade_changed: "O cadastro fiscal da ficha mudou depois da venda. Cancele a nota e crie outra.",
  duplicate_contact: "Há mais de um contato com este CNPJ no Bling. A integração bloqueou a duplicidade; solicite suporte.",
  duplicate_external_order: "Há mais de um pedido desta nota no Bling. A integração bloqueou a duplicidade; solicite suporte.",
  cancel_reconciliation_pending: "Cancelamento aguardando confirmação. Conclua pelo painel sem duplicar a devolução.",
  uncertain_write: "O Bling ainda não confirmou a operação. Tente novamente para o sistema consultar e recuperar o registro existente, sem duplicar a venda.",
  awaiting_bling_confirmation: "Aguardando confirmação do Bling. Verifique novamente pelo painel; o sistema recuperará a operação existente sem duplicá-la.",
  invoice_operation_date_required: "Informe a data e a hora de saída da mercadoria para continuar a emissão da mesma nota.",
  invoice_operation_date_invalid: "Confira a data e a hora de saída da mercadoria antes de continuar.",
  invoice_recipient_mismatch: "Os dados do cliente no Bling não conferem com os desta nota.",
  invoice_rejected_by_sefaz: "A SEFAZ recusou a nota. Solicite revisão fiscal pelo suporte. A nota não será reenviada às cegas.",
  invoice_cancelled_in_bling: "A nota foi cancelada no Bling. Cancele aqui para devolver as fichas ao estoque.",
  validation_error: "O Bling recusou algum dado da nota. Confira o endereço e a inscrição estadual do cliente.",
  buyer_outside_mg: "Só emitimos nota de atacado para empresas de Minas Gerais.",
  storage_unavailable: "O sistema não conseguiu salvar o andamento. Tente de novo em instantes.",
  unexpected_error: "A nota não foi emitida por um erro inesperado. Tente de novo."
};
export const wholesaleReason = (code: string | null) => (code && reasons[code]) || "A nota não foi emitida. Tente de novo.";

export function wholesaleStatus(invoice: Pick<WholesaleInvoice, "status" | "stage">): { label: string; tone: "ok" | "warn" | "bad" | "info" | "off" } {
  if (invoice.status === "authorized") return { label: "Autorizada", tone: "ok" };
  if (invoice.status === "cancelled") return { label: "Cancelada", tone: "off" };
  if (invoice.status === "error") return { label: "Com erro", tone: "bad" };
  if (invoice.status === "issuing") return { label: "Emitindo", tone: "info" };
  if (invoice.stage === "sent") return { label: "Aguardando a SEFAZ", tone: "warn" };
  if (invoice.stage === "draft_in_bling") return { label: "Rascunho no Bling", tone: "warn" };
  if (invoice.stage === "sale_created") return { label: "Venda no Bling", tone: "warn" };
  return { label: "Aguardando emissão", tone: "warn" };
}

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
};

export function WholesaleInvoiceList({ invoices, busyId, onRetry, onCancel }: {
  invoices: WholesaleInvoice[]; busyId: string; onRetry: (id: string) => void; onCancel: (id: string) => void;
}) {
  if (!invoices.length) return <p className="wholesale-empty">Nenhuma nota de atacado ainda. Use Emitir nota para criar a primeira.</p>;
  return <ul className="wholesale-list">
    {invoices.map(invoice => {
      const status = wholesaleStatus(invoice);
      const open = invoice.status === "draft" || invoice.status === "error";
      return <li key={invoice.id} className="wholesale-row">
        <div className="wholesale-row-main">
          <strong>{invoice.buyerName}</strong>
          <span>{formatCnpj(invoice.buyerDocument)} · {formatDate(invoice.createdAt)}</span>
        </div>
        <div className="wholesale-row-kit">
          <span>{invoice.kitName}</span>
          <span>{invoice.templateLabel} · {invoice.quantity} {invoice.quantity === 1 ? "ficha" : "fichas"}</span>
        </div>
        <strong className="wholesale-row-total">{formatBRL(invoice.totalInCents)}</strong>
        <div className="wholesale-row-status">
          <span className={`wholesale-badge ${status.tone}`}>{status.label}</span>
          {invoice.invoiceNumber && <span>NF-e nº {invoice.invoiceNumber}</span>}
          {open && invoice.errorCode && <span className="wholesale-row-reason">{wholesaleReason(invoice.errorCode)}</span>}
        </div>
        <div className="wholesale-row-actions">
          <InvoiceActions authorized={invoice.authorized} blingInvoiceId={invoice.invoiceId}
            pdfUrl={`/api/fiscal/wholesale-invoices/invoice-pdf?id=${invoice.id}`} label={`NF-e nº ${invoice.invoiceNumber ?? ""}`.trim()} />
          {open && !invoice.cancelPending && <button className="secondary-button" type="button" disabled={busyId === invoice.id} onClick={() => onRetry(invoice.id)}>Tentar de novo</button>}
          {invoice.canCancel && <button className="secondary-button danger-button" type="button" disabled={busyId === invoice.id} onClick={() => onCancel(invoice.id)}>{invoice.cancelPending || invoice.status === "cancelled" ? "Concluir cancelamento" : "Cancelar e devolver estoque"}</button>}
        </div>
      </li>;
    })}
  </ul>;
}

export function KitStep({ offers, kitId, template, onKit, onTemplate }: {
  offers: WholesaleOffer[]; kitId: string; template: string; onKit: (id: string) => void; onTemplate: (code: string) => void;
}) {
  const kit = offers.find(offer => offer.kitId === kitId);
  if (!offers.length) return <p className="wholesale-empty">Nenhum kit com as três fichas e os preços configurados. Configure em Kits.</p>;
  return <div className="wholesale-step">
    <fieldset className="wholesale-choice">
      <legend>Qual kit?</legend>
      <div className="wholesale-cards">
        {offers.map(offer => <button key={offer.kitId} type="button" className="wholesale-card" aria-pressed={offer.kitId === kitId} onClick={() => onKit(offer.kitId)}>
          <strong>{offer.name}</strong>
          {offer.description && <span>{offer.description}</span>}
        </button>)}
      </div>
    </fieldset>
    {kit && <fieldset className="wholesale-choice">
      <legend>Qual ficha?</legend>
      <div className="wholesale-cards">
        {kit.templates.map(item => {
          const pairs = item.sizes.reduce((total, size) => total + size.pairs, 0);
          return <button key={item.code} type="button" className="wholesale-card" aria-pressed={item.code === template}
            disabled={item.available < 1} onClick={() => onTemplate(item.code)}>
            <strong>{item.label}</strong>
            <span>{pairs} pares: {item.sizes.map(size => `${size.size} ×${size.pairs}`).join(" · ")}</span>
            <span>{formatBRL(item.unitPriceInCents)} por ficha</span>
            <span className={item.available < 1 ? "wholesale-out" : ""}>{item.available < 1 ? "Esgotada" : `${item.available} em estoque`}</span>
          </button>;
        })}
      </div>
    </fieldset>}
  </div>;
}

export type LookupState = "idle" | "loading" | "found" | "missing" | "failed";

export function ClientStep({ buyer, lookup, onChange, onRetryLookup, postalLookup = "idle" }: {
  buyer: WholesaleBuyer; lookup: LookupState; onChange: (patch: Partial<WholesaleBuyer>) => void; onRetryLookup?: () => void;
  postalLookup?: PostalLookupState;
}) {
  const cnpjId = useId();
  const digits = onlyDigits(buyer.document);
  const invalid = digits.length === 14 && !isValidCnpj(digits);
  const outside = buyer.state !== "" && buyer.state !== "MG";
  const field = (label: string, key: keyof WholesaleBuyer, extra: { wide?: boolean; max?: number; mode?: "numeric"; required?: boolean; hint?: string } = {}) =>
    <label className={extra.wide ? "wide" : undefined}>
      <span>{label}{extra.required === false ? " (opcional)" : ""}</span>
      <input value={buyer[key]} maxLength={extra.max} inputMode={extra.mode} autoComplete="off"
        onChange={event => onChange({ [key]: event.target.value })} />
      {extra.hint && <small>{extra.hint}</small>}
    </label>;
  return <div className="wholesale-step">
    <label className="wholesale-cnpj" htmlFor={cnpjId}>
      <span>CNPJ do cliente</span>
      <input id={cnpjId} inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" value={formatCnpj(buyer.document)}
        aria-invalid={invalid} onChange={event => onChange({ document: onlyDigits(event.target.value).slice(0, 14) })} />
    </label>
    <p className="wholesale-lookup" role="status">
      {invalid ? "CNPJ inválido. Confira os números."
        : lookup === "loading" ? "Buscando na Receita…"
        : lookup === "found" ? "Dados da empresa preenchidos. Confira antes de continuar."
        : lookup === "missing" ? "CNPJ não encontrado na Receita. Preencha os dados abaixo."
        : lookup === "failed" ? "Não foi possível consultar agora. Preencha os dados abaixo."
        : "Digite o CNPJ para preencher os dados da empresa."}
    </p>
    {(lookup === "failed" || lookup === "missing") && onRetryLookup && <button type="button" className="secondary-button" onClick={onRetryLookup}>Consultar novamente</button>}
    {outside && <p className="wholesale-alert" role="alert">Só emitimos nota de atacado para empresas de Minas Gerais. Esta empresa é de {buyer.state}.</p>}
    <div className="wholesale-fields">
      {field("Razão social", "name", { wide: true, max: 180 })}
      <label><span>Inscrição estadual (obrigatória)</span>
        <input value={buyer.registration} maxLength={18} autoComplete="off" placeholder="13 dígitos ou ISENTA"
          onChange={event => onChange({ registration: event.target.value.toUpperCase() })} />
        <small>Informe os 13 dígitos da IE ativa de MG. Se não souber, <a href="https://www.fazenda.mg.gov.br/empresas/Cadastro/cadastro/consultapublica.html" target="_blank" rel="noopener noreferrer">consulte pelo CNPJ no SINTEGRA</a>.</small>
      </label>
      {buyer.registration.trim().toUpperCase() === "ISENTA" && <p className="wholesale-alert wide" role="alert">O atacado é destinado à revenda. Confira a IE do comprador no SINTEGRA antes de continuar.</p>}
      <label><span>CEP</span><input inputMode="numeric" autoComplete="off" placeholder="00000-000" value={formatCep(buyer.postalCode)}
        onChange={event => onChange({ postalCode: onlyDigits(event.target.value).slice(0, 8) })} />
        <small role="status">{postalLookup === "loading" ? "Buscando endereço…"
          : postalLookup === "found" ? "Endereço encontrado. Confira os dados."
          : postalLookup === "partial" ? "CEP encontrado. Complete os campos restantes."
          : postalLookup === "missing" ? "CEP não encontrado. Confira o número."
          : postalLookup === "failed" ? "Consulta indisponível. Preencha o endereço manualmente."
          : "Digite o CEP para preencher o endereço."}</small>
      </label>
      {field("Rua", "street", { wide: true, max: 180 })}
      {field("Número", "number", { max: 30 })}
      {field("Complemento", "complement", { required: false, max: 100 })}
      {field("Bairro", "district", { max: 100 })}
      {field("Cidade", "city", { max: 100 })}
      <label><span>UF</span><input value={buyer.state} maxLength={2} autoComplete="off"
        onChange={event => onChange({ state: event.target.value.toUpperCase().replace(/[^A-Z]/gu, "") })} /></label>
    </div>
  </div>;
}

export const emptyBuyer: WholesaleBuyer = { document: "", name: "", registration: "", postalCode: "", street: "", number: "", complement: "", district: "", city: "", state: "MG" };

/** Reasons the client step cannot advance, in the order the accountant should fix them. */
export function buyerProblem(buyer: WholesaleBuyer): string | null {
  if (!isValidCnpj(buyer.document)) return "Informe um CNPJ válido.";
  if (buyer.state !== "MG") return "Só emitimos para empresas de Minas Gerais.";
  if (buyer.name.trim().length < 2) return "Informe a razão social.";
  const registration = buyer.registration.trim().toUpperCase();
  if (registration === "ISENTA") return "Para revenda, este fluxo exige inscrição estadual ativa de MG. Consulte o cadastro do CNPJ no SINTEGRA; não contribuinte não pode ser emitido como revenda neste fluxo.";
  if (!/^\d{13}$/u.test(registration.replace(/[.\-\s]/gu, ""))) return "Informe os 13 dígitos da inscrição estadual ativa de MG.";
  if (!/^3\d{7}$/u.test(buyer.postalCode)) return "Informe um CEP de Minas Gerais.";
  if (!buyer.street.trim() || !buyer.number.trim() || !buyer.district.trim() || !buyer.city.trim()) return "Complete o endereço.";
  return null;
}

export function PaymentStep({ template, kitName, quantity, price, method, buyerName, onQuantity, onPrice, onMethod }: {
  template: WholesaleTemplate; kitName: string; quantity: number; price: string; method: "pix" | "cash"; buyerName: string;
  onQuantity: (value: number) => void; onPrice: (value: string) => void; onMethod: (value: "pix" | "cash") => void;
}) {
  const priceId = useId();
  let cents = 0;
  try { cents = parseBRLToCents(price); } catch { cents = 0; }
  const total = cents * quantity;
  const clamp = (value: number) => Math.min(Math.max(1, Math.floor(value) || 1), Math.max(1, template.available));
  return <div className="wholesale-step">
    <div className="wholesale-fields">
      <div className="wholesale-quantity">
        <span>Quantidade de fichas</span>
        <div>
          <button type="button" className="icon-button" aria-label="Menos uma ficha" disabled={quantity <= 1} onClick={() => onQuantity(clamp(quantity - 1))}><Minus aria-hidden="true" /></button>
          <input aria-label="Quantidade de fichas" inputMode="numeric" value={quantity} onChange={event => onQuantity(clamp(Number(event.target.value)))} />
          <button type="button" className="icon-button" aria-label="Mais uma ficha" disabled={quantity >= template.available} onClick={() => onQuantity(clamp(quantity + 1))}><Plus aria-hidden="true" /></button>
        </div>
        <small>{template.available} em estoque</small>
      </div>
      <label htmlFor={priceId}>
        <span>Preço por ficha</span>
        <input id={priceId} inputMode="decimal" value={price} onChange={event => onPrice(event.target.value)} aria-invalid={cents < 12} />
        <small>Sugerido: {formatBRL(template.unitPriceInCents)}. Pode ajustar.</small>
      </label>
    </div>
    <fieldset className="wholesale-choice">
      <legend>Como o cliente pagou?</legend>
      <div className="wholesale-methods">
        {([["pix", "Pix"], ["cash", "Dinheiro"]] as const).map(([value, label]) =>
          <button key={value} type="button" className="wholesale-card" aria-pressed={method === value} onClick={() => onMethod(value)}><strong>{label}</strong></button>)}
      </div>
    </fieldset>
    <dl className="wholesale-summary" aria-label="Resumo da nota">
      <div><dt>Cliente</dt><dd>{buyerName}</dd></div>
      <div><dt>Produto</dt><dd>{kitName} · {template.label}</dd></div>
      <div><dt>Valor</dt><dd>{quantity} × {formatBRL(cents)}</dd></div>
      <div className="total"><dt>Total da nota</dt><dd>{formatBRL(total)}</dd></div>
    </dl>
  </div>;
}

export function IssueProgress({ steps, running, result, onRetry, onCancel, onClose, busy, operationDate = "", onOperationDate }: {
  steps: string[]; running: boolean; result: Extract<IssueEvent, { type: "result" }> | null;
  onRetry: () => void; onCancel: () => void; onClose: () => void; busy: boolean;
  operationDate?: string; onOperationDate?: (value: string) => void;
}) {
  const failed = result?.status === "error" || result?.status === "waiting" || result?.status === "busy";
  const current = steps.at(-1);
  const needsDate = result?.code === "invoice_operation_date_required" || result?.code === "invoice_operation_date_invalid";
  return <div className="wholesale-step" aria-live="polite">
    <ol className="wholesale-progress">
      {issueSteps.map(([key, label]) => {
        const index = steps.indexOf(key);
        const done = result?.status === "authorized" || (index >= 0 && key !== current) || (index >= 0 && !running && !failed);
        const active = running && key === current;
        return <li key={key} className={done ? "done" : active ? "active" : ""}>
          <span aria-hidden="true">{done ? <Check /> : active ? <LoaderCircle className="spin" /> : null}</span>{label}
        </li>;
      })}
    </ol>
    {running && <p>Emitindo a nota. Não feche esta janela.</p>}
    {result?.status === "authorized" && <div className="wholesale-done">
      <p><strong>Nota {result.invoice?.invoiceNumber ? `nº ${result.invoice.invoiceNumber} ` : ""}autorizada.</strong></p>
      {result.invoice && <InvoiceActions authorized={result.invoice.authorized} blingInvoiceId={result.invoice.invoiceId}
        pdfUrl={`/api/fiscal/wholesale-invoices/invoice-pdf?id=${result.invoice.id}`} label={`NF-e nº ${result.invoice.invoiceNumber ?? ""}`.trim()} />}
    </div>}
    {failed && <p className={result?.status === "error" ? "wholesale-alert" : "wholesale-note"} role={result?.status === "error" ? "alert" : "status"}>
      {result?.status === "busy" ? "Esta nota já está sendo emitida. Aguarde alguns instantes e verifique de novo." : wholesaleReason(result?.code ?? null)}
    </p>}
    {needsDate && onOperationDate && <DepartureField value={operationDate} onChange={onOperationDate} />}
    <div className="wholesale-actions">
      {failed && !result?.invoice?.cancelPending && <button className="primary-button" type="button" disabled={busy || (needsDate && !operationDate)} onClick={onRetry}>{result?.code === "awaiting_authorization" ? "Verificar de novo" : "Tentar de novo"}</button>}
      {failed && result?.invoice?.canCancel === true && <button className="secondary-button danger-button" type="button" disabled={busy} onClick={onCancel}>Cancelar e devolver estoque</button>}
      {!running && <button className="secondary-button" type="button" onClick={onClose}>Fechar</button>}
    </div>
  </div>;
}

export function DepartureField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="wholesale-fields"><label><span>Data e hora de saída da mercadoria</span>
    <input type="datetime-local" value={value} onChange={event => onChange(event.target.value)} />
    <small>Informe a saída real ou prevista, no horário de Brasília. Confira antes de emitir.</small>
  </label></div>;
}

export type KitSelection = { kitId: string; template: string; quantity: number; price: string };
type Wizard = { step: 1 | 2 | 3 | 4; selections: KitSelection[]; buyer: WholesaleBuyer; method: "pix" | "cash" };
const newWizard = (): Wizard => ({ step: 1, selections: [], buyer: emptyBuyer, method: "pix" });

export function selectionProblem(offers: WholesaleOffer[], selections: KitSelection[]) {
  if (!selections.length || selections.length > 20 || new Set(selections.map(item => item.kitId)).size !== selections.length)
    return "Selecione de um a vinte kits distintos.";
  for (const selection of selections) {
    const kit = offers.find(item => item.kitId === selection.kitId);
    const template = kit?.templates.find(item => item.code === selection.template);
    if (!kit || !template || !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > Math.min(99, template.available))
      return "Escolha uma ficha disponível para cada kit e confira as quantidades.";
  }
  return null;
}

const selectionPrice = (price: string) => { try { return parseBRLToCents(price); } catch { return 0; } };

export function MultiKitStep({ offers, selections, onChange }: {
  offers: WholesaleOffer[]; selections: KitSelection[]; onChange: (selections: KitSelection[]) => void;
}) {
  if (!offers.length) return <p className="wholesale-empty">Nenhum kit com as três fichas e os preços configurados. Configure em Kits.</p>;
  return <div className="wholesale-step">
    <p className="wholesale-note">Selecione os kits da venda. Para cada kit escolhido, selecione uma ficha.</p>
    <fieldset className="wholesale-choice">
      <legend>Kits da nota ({selections.length})</legend>
      <div className="wholesale-cards">
        {offers.map(offer => {
          const selection = selections.find(item => item.kitId === offer.kitId);
          const available = offer.templates.some(item => item.available > 0);
          return <button key={offer.kitId} type="button" className="wholesale-card" aria-pressed={Boolean(selection)}
            disabled={!selection && (!available || selections.length >= 20)}
            onClick={() => onChange(selection ? selections.filter(item => item.kitId !== offer.kitId)
              : [...selections, { kitId: offer.kitId, template: "", quantity: 1, price: "" }])}>
            <strong>{offer.name}</strong>
            {offer.description && <span>{offer.description}</span>}
            <span>{selection ? "Selecionado · clique para remover" : available ? "Selecionar" : "Esgotado"}</span>
          </button>;
        })}
      </div>
    </fieldset>
    {selections.map(selection => {
      const kit = offers.find(offer => offer.kitId === selection.kitId);
      if (!kit) return null;
      return <fieldset key={selection.kitId} className="wholesale-choice">
        <legend>{kit.name} — ficha</legend>
        <div className="wholesale-cards">
          {kit.templates.map(template => <button key={template.code} type="button" className="wholesale-card"
            aria-pressed={selection.template === template.code} disabled={template.available < 1}
            onClick={() => onChange(selections.map(item => item.kitId === selection.kitId
              ? { ...item, template: template.code, quantity: Math.min(item.quantity, template.available), price: formatBRLInput(template.unitPriceInCents) } : item))}>
            <strong>{template.label}</strong>
            <span>{template.sizes.map(size => size.size + " ×" + size.pairs).join(" · ")}</span>
            <span>{formatBRL(template.unitPriceInCents)} por ficha</span>
            <span>{template.available > 0 ? template.available + " em estoque" : "Esgotada"}</span>
          </button>)}
        </div>
      </fieldset>;
    })}
  </div>;
}

export function MultiPaymentStep({ offers, selections, buyerName, method, onChange, onMethod }: {
  offers: WholesaleOffer[]; selections: KitSelection[]; buyerName: string; method: "pix" | "cash";
  onChange: (selections: KitSelection[]) => void; onMethod: (value: "pix" | "cash") => void;
}) {
  const total = selections.reduce((sum, item) => sum + selectionPrice(item.price) * item.quantity, 0);
  const change = (id: string, patch: Partial<KitSelection>) => onChange(selections.map(item => item.kitId === id ? { ...item, ...patch } : item));
  return <div className="wholesale-step">
    {selections.map(selection => {
      const kit = offers.find(item => item.kitId === selection.kitId);
      const template = kit?.templates.find(item => item.code === selection.template);
      if (!kit || !template) return null;
      const limit = Math.min(99, template.available);
      return <fieldset key={kit.kitId} className="wholesale-choice">
        <legend>{kit.name} · {template.label}</legend>
        <div className="wholesale-fields">
          <label><span>Quantidade de fichas</span><input type="number" min={1} max={limit} value={selection.quantity}
            onChange={event => change(kit.kitId, { quantity: Math.min(Math.max(1, Math.floor(Number(event.target.value)) || 1), Math.max(1, limit)) })} />
            <small>{template.available} em estoque</small></label>
          <label><span>Preço por ficha</span><input inputMode="decimal" value={selection.price}
            onChange={event => change(kit.kitId, { price: event.target.value })} aria-invalid={selectionPrice(selection.price) < 12} />
            <small>Sugerido: {formatBRL(template.unitPriceInCents)}</small></label>
        </div>
        <p>Subtotal: <strong>{formatBRL(selectionPrice(selection.price) * selection.quantity)}</strong></p>
      </fieldset>;
    })}
    <fieldset className="wholesale-choice"><legend>Como o cliente pagou?</legend>
      <div className="wholesale-methods">
        {([["pix", "Pix"], ["cash", "Dinheiro"]] as const).map(([value, label]) =>
          <button key={value} type="button" className="wholesale-card" aria-pressed={method === value} onClick={() => onMethod(value)}><strong>{label}</strong></button>)}
      </div>
    </fieldset>
    <dl className="wholesale-summary" aria-label="Resumo da nota">
      <div><dt>Cliente</dt><dd>{buyerName}</dd></div>
      <div><dt>Kits</dt><dd>{selections.length} · {selections.reduce((sum, item) => sum + item.quantity, 0)} fichas</dd></div>
      <div className="total"><dt>Total da nota</dt><dd>{formatBRL(total)}</dd></div>
    </dl>
  </div>;
}
const stepTitles = ["Kits e fichas", "Cliente", "Quantidade e pagamento", "Emissão"];

async function readMessage(response: Response, fallback: string) {
  try { return str(record(await response.json())?.message) || fallback; } catch { return fallback; }
}

export function WholesaleInvoiceManager() {
  const [offers, setOffers] = useState<WholesaleOffer[]>([]);
  const [invoices, setInvoices] = useState<WholesaleInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [lookup, setLookup] = useState<LookupState>("idle");
  const [postalLookup, setPostalLookup] = useState<PostalLookupState>("idle");
  const [problem, setProblem] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Extract<IssueEvent, { type: "result" }> | null>(null);
  const [issuingId, setIssuingId] = useState("");
  const [operationDate, setOperationDate] = useState("");
  const key = useRef("");
  const [lookupRetry, setLookupRetry] = useState(0);
  const titleId = useId();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { cache: "no-store" });
      const body = record(await response.json());
      if (!response.ok || !body) throw new Error("unavailable");
      setOffers(readOffers(body.offers));
      setInvoices((Array.isArray(body.invoices) ? body.invoices : []).map(readInvoice).filter((item): item is WholesaleInvoice => item !== null));
      setError("");
    } catch { setError("Não foi possível carregar as notas de atacado."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cnpj = wizard?.buyer.document ?? "";
  useEffect(() => {
    if (!isValidCnpj(cnpj)) { setLookup("idle"); return; }
    setLookup("loading");
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/fiscal/cnpj?cnpj=${cnpj}`, { cache: "no-store", signal: controller.signal });
        const body = record(await response.json());
        if (controller.signal.aborted) return;
        if (!response.ok || !body || body.unavailable === true) { setLookup("failed"); return; }
        if (body.found !== true) { setLookup("missing"); return; }
        const a = record(body.address) ?? {};
        setWizard(current => current && current.buyer.document === cnpj ? { ...current, buyer: {
          ...current.buyer, registration: current.buyer.registration || str(body.registration), name: current.buyer.name || str(body.name),
          ...(current.buyer.postalCode ? {} : {
            postalCode: onlyDigits(str(a.postal_code)).slice(0, 8), street: current.buyer.street || str(a.street),
            number: current.buyer.number || str(a.number), complement: current.buyer.complement || str(a.complement),
            district: current.buyer.district || str(a.district), city: current.buyer.city || str(a.city), state: str(a.state) || current.buyer.state
          })
        } } : current);
        setLookup("found");
      } catch { if (!controller.signal.aborted) setLookup("failed"); }
    })();
    return () => controller.abort();
  }, [cnpj, lookupRetry]);

  const postalCode = wizard?.buyer.postalCode ?? "";
  useEffect(() => {
    if (postalCode.length !== 8) { setPostalLookup("idle"); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let disposed = false;
    setPostalLookup("loading");
    void lookupFiscalPostalCode(postalCode, controller.signal).then(result => {
      if (disposed) return;
      setPostalLookup(result.status);
      if (result.status === "found" || result.status === "partial") {
        setWizard(current => current && current.buyer.document === cnpj && current.buyer.postalCode === postalCode
          ? { ...current, buyer: mergePostalAddress(current.buyer, result.address) } : current);
      }
    }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [postalCode, cnpj]);

  function changeBuyer(value: Partial<WholesaleBuyer>) {
    setWizard(current => {
      if (!current) return current;
      const buyer = current.buyer;
      if (value.document !== undefined && value.document !== buyer.document) return { ...current, buyer: { ...emptyBuyer, ...value } };
      const changedPostal = value.postalCode !== undefined && value.postalCode !== buyer.postalCode;
      const clearAddress = changedPostal && buyer.postalCode.length === 8;
      return { ...current, buyer: { ...buyer,
        ...(clearAddress ? { street: "", number: "", complement: "", district: "", city: "", state: "" }
          : changedPostal && buyer.postalCode === "" ? { state: "" } : {}), ...value } };
    });
  }

  function open() {
    key.current = crypto.randomUUID();
    setOperationDate("");
    setLookup("idle"); setPostalLookup("idle"); setProblem(""); setSteps([]); setResult(null); setRunning(false); setIssuingId(""); setNotice("");
    setWizard(newWizard());
  }
  const close = useCallback(() => { if (!running) { setWizard(null); void load(); } }, [running, load]);
  useEffect(() => {
    if (!wizard) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizard, close]);

  const patch = (value: Partial<Wizard>) => setWizard(current => current ? { ...current, ...value } : current);

  function next() {
    if (!wizard) return;
    setProblem("");
    if (wizard.step === 1) {
      const issue = selectionProblem(offers, wizard.selections);
      if (issue) { setProblem(issue); return; }
      patch({ step: 2 });
    } else if (wizard.step === 2) {
      const issue = buyerProblem(wizard.buyer);
      if (issue) { setProblem(issue); return; }
      patch({ step: 3 });
    }
  }

  async function runIssue(id: string, reviewedDate?: string) {
    setIssuingId(id); setSteps([]); setResult(null); setRunning(true); setNotice("");
    let final: Extract<IssueEvent, { type: "result" }> | null = null;
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "issue", id, ...(reviewedDate ? { operationDate: reviewedDate } : {}) }) });
      if (!response.ok || !response.body) {
        final = { type: "result", status: response.status === 409 ? "busy" : "error", code: "unexpected_error", invoice: null };
        setNotice(await readMessage(response, ""));
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          const event = line.trim() ? parseIssueLine(line) : null;
          if (event?.type === "step") setSteps(current => current.includes(event.step) ? current : [...current, event.step]);
          if (event?.type === "result") final = event;
        };
        for (;;) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
          if (done) break;
        }
        handle(buffer);
      }
    } catch { /* The state is read back from the list below. */ }
    setResult(final ?? { type: "result", status: "error", code: "unexpected_error", invoice: null });
    setRunning(false);
    void load();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!wizard || wizard.step !== 3 || running) return;
    const issue = selectionProblem(offers, wizard.selections) || buyerProblem(wizard.buyer);
    if (issue) { setProblem(issue); return; }
    if (!operationDate) { setProblem("Informe a data e a hora de saída da mercadoria."); return; }
    const items = wizard.selections.map(item => ({ kitId: item.kitId, template: item.template, quantity: item.quantity, unitPriceInCents: selectionPrice(item.price) }));
    if (items.some(item => !Number.isSafeInteger(item.unitPriceInCents) || item.unitPriceInCents < 12 || item.unitPriceInCents > 100_000_000)) { setProblem("Confira o preço por ficha de todos os kits."); return; }
    setProblem("");
    patch({ step: 4 });
    setRunning(true);
    const b = wizard.buyer;
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_batch", key: key.current, items, paymentMethod: wizard.method, buyer: { document: b.document, name: b.name.trim(), registration: b.registration.trim().toUpperCase().replace(/[.\-\s]/gu, ""),
            address: { state: b.state, postal_code: b.postalCode, street: b.street.trim(), number: b.number.trim(),
              district: b.district.trim(), city: b.city.trim(), complement: b.complement.trim() } } }) });
      const body = record(await response.json());
      const created = readInvoice(body?.invoice);
      if (!response.ok || !created) {
        setRunning(false); patch({ step: 3 }); setProblem(str(body?.message) || "Não foi possível criar a nota.");
        return;
      }
      await runIssue(created.id, operationDate);
    } catch { setRunning(false); patch({ step: 3 }); setProblem("Não foi possível criar a nota. Tente de novo."); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancelar esta nota e devolver as fichas ao estoque?")) return;
    setBusyId(id); setNotice("");
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", id }) });
      const body = record(await response.json());
      if (!response.ok) setNotice(str(body?.message) || "Não foi possível cancelar a nota.");
      else {
        setNotice("Cancelamento concluído. Estoque conciliado pelo sistema.");
        setWizard(null);
      }
    } catch { setNotice("Não foi possível cancelar a nota."); }
    finally { setBusyId(""); void load(); }
  }

  function retryFromList(id: string) {
    key.current = "";
    setOperationDate("");
    setWizard({ ...newWizard(), step: 4 });
    void runIssue(id);
  }

  return <section className="panel-card wholesale">
    <header className="wholesale-header">
      <p>Emita uma NF-e com um ou vários kits para uma empresa de Minas Gerais. CFOP, série e natureza são automáticos.</p>
      <button className="primary-button" type="button" onClick={open}>Emitir nota</button>
    </header>
    {notice && <p className="wholesale-note" role="status">{notice}</p>}
    {error && <p className="wholesale-alert" role="alert">{error} <button className="secondary-button" type="button" onClick={() => void load()}>Tentar de novo</button></p>}
    {loading ? <p className="wholesale-empty" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Carregando</p>
      : <WholesaleInvoiceList invoices={invoices} busyId={busyId} onRetry={retryFromList} onCancel={id => void cancel(id)} />}

    {wizard && <div className="admin-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <form className="admin-modal wholesale-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={event => void submit(event)}>
        <header>
          <div>
            <h2 id={titleId}>Emitir nota de atacado</h2>
            <p>{wizard.step < 4 ? `Passo ${wizard.step} de 3 · ${stepTitles[wizard.step - 1]}` : stepTitles[3]}</p>
          </div>
          <button type="button" aria-label="Fechar" disabled={running} onClick={close}><X aria-hidden="true" /></button>
        </header>
        <div className="wholesale-body">
          {wizard.step === 1 && <MultiKitStep offers={offers} selections={wizard.selections} onChange={selections => patch({ selections })} />}
          {wizard.step === 2 && <ClientStep buyer={wizard.buyer} lookup={lookup} postalLookup={postalLookup} onRetryLookup={() => setLookupRetry(value => value + 1)} onChange={changeBuyer} />}
          {wizard.step === 3 && <MultiPaymentStep offers={offers} selections={wizard.selections} method={wizard.method} buyerName={wizard.buyer.name}
            onChange={selections => patch({ selections })} onMethod={value => patch({ method: value })} />}
          {wizard.step === 3 && <DepartureField value={operationDate} onChange={setOperationDate} />}
          {wizard.step === 4 && <IssueProgress steps={steps} running={running} result={result} busy={busyId !== ""} onClose={close}
            operationDate={operationDate} onOperationDate={setOperationDate}
            onRetry={() => void runIssue(issuingId, operationDate)} onCancel={() => void cancel(issuingId)} />}
          {problem && <p className="wholesale-alert" role="alert">{problem}</p>}
        </div>
        {wizard.step < 4 && <footer className="wholesale-footer">
          {wizard.step > 1 ? <button className="secondary-button" type="button" onClick={() => patch({ step: wizard.step === 3 ? 2 : 1 })}>Voltar</button> : <span />}
          {wizard.step < 3 ? <button className="primary-button" type="button" onClick={next}>Continuar</button>
            : <button className="primary-button" type="submit" disabled={running}>Emitir nota</button>}
        </footer>}
      </form>
    </div>}
  </section>;
}
