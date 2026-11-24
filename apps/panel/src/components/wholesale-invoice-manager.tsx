"use client";

import { formatBRL, formatBRLInput, parseBRLToCents } from "@curtiz/domain";
import { Check, LoaderCircle, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatCep, formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj";
import { InvoiceActions } from "./invoice-actions";

export type WholesaleTemplate = { code: string; label: string; available: number; unitPriceInCents: number; sizes: { size: string; pairs: number }[] };
export type WholesaleOffer = { kitId: string; name: string; description: string; templates: WholesaleTemplate[] };
export type WholesaleInvoice = {
  id: string; status: string; stage: string; kitName: string; templateLabel: string; quantity: number; totalInCents: number;
  paymentMethod: string; buyerName: string; buyerDocument: string; invoiceId: number | null; invoiceNumber: string | null;
  authorized: boolean; errorCode: string | null; canCancel: boolean; createdAt: string;
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
    canCancel: row.canCancel === true, createdAt: str(row.createdAt)
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
  bling_send_disabled: "A nota está pronta como rascunho no Bling. O envio à SEFAZ está desligado: confira e envie pelo Bling, ou ligue o envio e use Tentar de novo.",
  awaiting_authorization: "A nota foi enviada, mas a SEFAZ ainda não respondeu. Verifique de novo em instantes.",
  payment_method_required: "A forma de pagamento (Pix ou Dinheiro) não está configurada no Bling.",
  kit_fiscal_clearance_failed: "A conferência fiscal não passou. Confira os dados do cliente e o cadastro fiscal do produto.",
  wholesale_grade_changed: "O cadastro fiscal da ficha mudou depois da venda. Cancele a nota e crie outra.",
  duplicate_contact: "Há mais de um contato com este CNPJ no Bling. Deixe só um e tente de novo.",
  duplicate_external_order: "Há mais de um pedido desta nota no Bling. Deixe só um e tente de novo.",
  uncertain_write: "O Bling não confirmou a gravação. Confira no Bling se o pedido ATACADO já existe antes de tentar de novo.",
  invoice_recipient_mismatch: "Os dados do cliente no Bling não conferem com os desta nota.",
  invoice_rejected_by_sefaz: "A SEFAZ recusou a nota. Corrija o motivo no Bling e tente de novo, ou cancele.",
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
          {open && <button className="secondary-button" type="button" disabled={busyId === invoice.id} onClick={() => onRetry(invoice.id)}>Tentar de novo</button>}
          {open && invoice.canCancel && <button className="secondary-button danger-button" type="button" disabled={busyId === invoice.id} onClick={() => onCancel(invoice.id)}>Cancelar e devolver estoque</button>}
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

export function ClientStep({ buyer, lookup, onChange }: {
  buyer: WholesaleBuyer; lookup: LookupState; onChange: (patch: Partial<WholesaleBuyer>) => void;
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
    {outside && <p className="wholesale-alert" role="alert">Só emitimos nota de atacado para empresas de Minas Gerais. Esta empresa é de {buyer.state}.</p>}
    <div className="wholesale-fields">
      {field("Razão social", "name", { wide: true, max: 180 })}
      {field("Inscrição estadual", "registration", { required: false, mode: "numeric", max: 14, hint: "Sem inscrição, a nota sai para cliente não contribuinte." })}
      <label><span>CEP</span><input inputMode="numeric" autoComplete="off" value={formatCep(buyer.postalCode)}
        onChange={event => onChange({ postalCode: onlyDigits(event.target.value).slice(0, 8) })} /></label>
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
  if (buyer.registration && !/^\d{2,14}$/u.test(buyer.registration)) return "A inscrição estadual deve ter só números.";
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

export function IssueProgress({ steps, running, result, onRetry, onCancel, onClose, busy }: {
  steps: string[]; running: boolean; result: Extract<IssueEvent, { type: "result" }> | null;
  onRetry: () => void; onCancel: () => void; onClose: () => void; busy: boolean;
}) {
  const failed = result?.status === "error" || result?.status === "waiting" || result?.status === "busy";
  const current = steps.at(-1);
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
    <div className="wholesale-actions">
      {failed && <button className="primary-button" type="button" disabled={busy} onClick={onRetry}>{result?.code === "awaiting_authorization" ? "Verificar de novo" : "Tentar de novo"}</button>}
      {failed && result?.invoice?.canCancel !== false && <button className="secondary-button danger-button" type="button" disabled={busy} onClick={onCancel}>Cancelar e devolver estoque</button>}
      {!running && <button className="secondary-button" type="button" onClick={onClose}>Fechar</button>}
    </div>
  </div>;
}

type Wizard = { step: 1 | 2 | 3 | 4; kitId: string; template: string; buyer: WholesaleBuyer; quantity: number; price: string; method: "pix" | "cash" };
const newWizard = (): Wizard => ({ step: 1, kitId: "", template: "", buyer: emptyBuyer, quantity: 1, price: "", method: "pix" });
const stepTitles = ["Kit e ficha", "Cliente", "Quantidade e pagamento", "Emissão"];

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
  const [problem, setProblem] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Extract<IssueEvent, { type: "result" }> | null>(null);
  const [issuingId, setIssuingId] = useState("");
  const key = useRef("");
  const lookedUp = useRef("");
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
    if (!isValidCnpj(cnpj) || lookedUp.current === cnpj) return;
    lookedUp.current = cnpj;
    setLookup("loading");
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/fiscal/cnpj?cnpj=${cnpj}`, { cache: "no-store", signal: controller.signal });
        const body = record(await response.json());
        if (!response.ok || !body) { setLookup("failed"); return; }
        if (body.found !== true) { setLookup("missing"); return; }
        const a = record(body.address) ?? {};
        setWizard(current => current && current.buyer.document === cnpj ? { ...current, buyer: {
          ...current.buyer, name: str(body.name) || current.buyer.name, postalCode: str(a.postal_code) || current.buyer.postalCode,
          street: str(a.street) || current.buyer.street, number: str(a.number) || current.buyer.number,
          complement: str(a.complement), district: str(a.district) || current.buyer.district,
          city: str(a.city) || current.buyer.city, state: str(a.state) || current.buyer.state
        } } : current);
        setLookup("found");
      } catch { if (!controller.signal.aborted) setLookup("failed"); }
    })();
    return () => controller.abort();
  }, [cnpj]);

  function open() {
    key.current = crypto.randomUUID();
    lookedUp.current = "";
    setLookup("idle"); setProblem(""); setSteps([]); setResult(null); setRunning(false); setIssuingId(""); setNotice("");
    setWizard(newWizard());
  }
  const close = useCallback(() => { if (!running) { setWizard(null); void load(); } }, [running, load]);
  useEffect(() => {
    if (!wizard) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wizard, close]);

  const kit = offers.find(item => item.kitId === wizard?.kitId);
  const template = kit?.templates.find(item => item.code === wizard?.template);
  const patch = (value: Partial<Wizard>) => setWizard(current => current ? { ...current, ...value } : current);

  function next() {
    if (!wizard) return;
    setProblem("");
    if (wizard.step === 1) {
      if (!kit || !template || template.available < 1) { setProblem("Escolha o kit e uma ficha em estoque."); return; }
      patch({ step: 2, price: wizard.price || formatBRLInput(template.unitPriceInCents), quantity: Math.min(wizard.quantity, template.available) });
    } else if (wizard.step === 2) {
      const issue = buyerProblem(wizard.buyer);
      if (issue) { setProblem(issue); return; }
      patch({ step: 3 });
    }
  }

  async function runIssue(id: string) {
    setIssuingId(id); setSteps([]); setResult(null); setRunning(true); setNotice("");
    let final: Extract<IssueEvent, { type: "result" }> | null = null;
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "issue", id }) });
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
    if (!wizard || !template || !kit || wizard.step !== 3 || running) return;
    let cents = 0;
    try { cents = parseBRLToCents(wizard.price); } catch { cents = 0; }
    if (cents < 12) { setProblem("Informe o preço por ficha."); return; }
    setProblem("");
    patch({ step: 4 });
    setRunning(true);
    const b = wizard.buyer;
    try {
      const response = await fetch("/api/fiscal/wholesale-invoices", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", key: key.current, kitId: kit.kitId, template: template.code, quantity: wizard.quantity,
          unitPriceInCents: cents, paymentMethod: wizard.method, buyer: { document: b.document, name: b.name.trim(), registration: b.registration,
            address: { state: b.state, postal_code: b.postalCode, street: b.street.trim(), number: b.number.trim(),
              district: b.district.trim(), city: b.city.trim(), complement: b.complement.trim() } } }) });
      const body = record(await response.json());
      const created = readInvoice(body?.invoice);
      if (!response.ok || !created) {
        setRunning(false); patch({ step: 3 }); setProblem(str(body?.message) || "Não foi possível criar a nota.");
        return;
      }
      await runIssue(created.id);
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
        setNotice(body?.blingResidue === true ? "Nota cancelada e fichas devolvidas. Já existia um pedido no Bling: exclua-o por lá." : "Nota cancelada e fichas devolvidas ao estoque.");
        setWizard(null);
      }
    } catch { setNotice("Não foi possível cancelar a nota."); }
    finally { setBusyId(""); void load(); }
  }

  function retryFromList(id: string) {
    key.current = "";
    setWizard({ ...newWizard(), step: 4 });
    void runIssue(id);
  }

  return <section className="panel-card wholesale">
    <header className="wholesale-header">
      <p>Emita a NF-e de um kit para uma empresa de Minas Gerais. CFOP, série e natureza são automáticos.</p>
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
          {wizard.step === 1 && <KitStep offers={offers} kitId={wizard.kitId} template={wizard.template}
            onKit={id => patch({ kitId: id, template: "", price: "" })} onTemplate={code => patch({ template: code, price: "" })} />}
          {wizard.step === 2 && <ClientStep buyer={wizard.buyer} lookup={lookup} onChange={value => patch({ buyer: { ...wizard.buyer, ...value } })} />}
          {wizard.step === 3 && template && kit && <PaymentStep template={template} kitName={kit.name} quantity={wizard.quantity} price={wizard.price}
            method={wizard.method} buyerName={wizard.buyer.name} onQuantity={value => patch({ quantity: value })}
            onPrice={value => patch({ price: value })} onMethod={value => patch({ method: value })} />}
          {wizard.step === 4 && <IssueProgress steps={steps} running={running} result={result} busy={busyId !== ""} onClose={close}
            onRetry={() => void runIssue(issuingId)} onCancel={() => void cancel(issuingId)} />}
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
