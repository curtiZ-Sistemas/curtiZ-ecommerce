"use client";

import { AlertTriangle, CircleCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Code, SectionHeader, StateMessage, StatusLabel, type UiTone } from "./panel-ui";

type Order = { orderId: string; publicCode: string; externalOrderId: number | null; invoiceId: number | null;
  erpStatus: string; invoiceStatus: string; lastErrorCode: string | null;
  jobStatus: string | null; jobError: string | null; placed_at: string | null;
  history?: Array<{ attempt: number; outcome: string; error_code: string | null; occurred_at: string }> };
const errorLabels: Record<string, string> = {
  fiscal_automation_policy_required: "Regras fiscais ainda não liberadas para automação",
  fiscal_recipient_required: "Confirme os dados fiscais do destinatário",
  fiscal_mirror_changed: "O pedido ou as regras mudaram; confira o espelho fiscal",
  fiscal_after_sale_authorization_required: "Pós-venda pendente: confira cancelamento ou devolução fiscal no Bling e com a contabilidade",
  kit_fiscal_composition_required: "Confira os pares, códigos e quantidades da composição fiscal do kit",
  fiscal_tax_codes_required: "Confirme os CSTs de PIS, COFINS e IPI",
  invoice_stock_automation_must_be_disabled: "Confirme no Bling que a NF-e não movimentará novamente o estoque",
  invoice_draft_decomposition_conflict: "A nota difere do pedido; consulte e confira antes de reprocessar",
  invoice_recipient_mismatch: "Confira documento, endereço e inscrição estadual do destinatário no Bling",
  order_nature_mismatch: "A natureza fiscal do pedido precisa de conferência no Bling",
  invoice_environment_required: "Ambiente de transmissão fiscal ainda não configurado",
  live_invoice_not_authorized: "Transmissão de nota real ainda não autorizada",
  invoice_processing: "Aguardando processamento da nota pelo Bling",
  fiscal_archive_unavailable: "Não foi possível arquivar o documento fiscal; tente novamente",
  product_mapping_required: "SKU sem vínculo confirmado no Bling",
  customer_identity_required: "CPF do cliente indisponível",
  payment_method_required: "Forma de pagamento do Bling não configurada",
  validation_error: "Dados rejeitados pelo Bling",
  uncertain_write: "Resultado externo incerto; concilie antes de repetir",
  lease_expired_reconciliation_required: "Processamento interrompido. Consulte o resultado no Bling antes de repetir.",
  rate_limited: "Limite temporário da API",
  reconnect_required: "Conexão Bling precisa ser renovada"
  ,fiscal_rejected_4: "Nota rejeitada. Consulte o retorno fiscal no Bling e corrija o cadastro com a contabilidade."
  ,fiscal_rejected_9: "Nota denegada. Consulte a contabilidade antes de qualquer nova emissão."
  ,commercial_change_requires_reconciliation: "Cancelamento ou reembolso local: confira venda e nota no Bling com a contabilidade."
  ,invoice_nature_mismatch: "Natureza da nota difere da configuração validada. Revise no Bling."
};
const statusLabels: Record<string, string> = {
  pending: "Aguardando ERP", synced: "No Bling", failed: "Falha",
  reconciliation_required: "Conciliação necessária", not_requested: "Nota não solicitada",
  awaiting_data: "Aguardando dados fiscais", processing: "Nota em processamento",
  authorized: "Nota autorizada", rejected: "Nota rejeitada", cancelled: "Nota cancelada", error: "Erro fiscal"
};
const erpTone = (status: string): UiTone =>
  status === "synced" ? "success" : status === "failed" || status === "reconciliation_required" ? "danger" : "warning";
const invoiceTone = (status: string): UiTone =>
  status === "authorized" ? "success" : status === "rejected" || status === "error" ? "danger" : status === "processing" ? "info" : "neutral";

export function BlingOperational({ readOnly = false }: { readOnly?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async (selected: string) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/integrations/bling/orders?filter=${selected}`, { cache: "no-store" });
      const result = await response.json() as { orders?: Order[]; message?: string };
      if (!response.ok || !Array.isArray(result.orders)) throw new Error(result.message || "Pendências indisponíveis.");
      setOrders(result.orders);
    } catch (failure) { setOrders([]); setError(failure instanceof Error ? failure.message : "Pendências indisponíveis."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(filter); }, [filter, load]);
  const retry = async (orderId: string, action: "retry" | "reconcile" | "prepare" | "send" | "consult" = "retry") => {
    setProcessing(orderId); setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/bling/orders", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, action }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Não foi possível solicitar a sincronização.");
      setMessage(result.message || "Sincronização solicitada."); await load(filter);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sincronização indisponível."); }
    finally { setProcessing(""); }
  };
  return <section className="panel-card bling-console" aria-busy={loading} aria-labelledby="bling-console-title">
    <SectionHeader id="bling-console-title" title="Pedidos no Bling" description="Situação da venda e da nota fiscal de cada pedido no ERP."
      actions={<label className="bling-console-filter"><span>Filtrar pendências</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">Todos</option><option value="pending">Aguardando ERP</option>
        <option value="failed">Falhas</option><option value="invoice">Aguardando nota</option>
      </select></label>} />
    {message ? <p role="status" className="admin-feedback success bling-console-feedback"><CircleCheck aria-hidden="true" /><span>{message}</span></p> : null}
    {loading ? <div className="ui-loading" role="status" aria-live="polite"><span className="sr-only">Carregando integração…</span>
      <span className="ui-skeleton" aria-hidden="true" /><span className="ui-skeleton" aria-hidden="true" /></div>
      : error ? <StateMessage kind="error" compact level={3} icon={AlertTriangle} title="Falha na integração" description={error}
        action={<button className="secondary-button" type="button" onClick={() => void load(filter)}><RefreshCw aria-hidden="true" /> Tentar novamente</button>} />
      : !orders.length ? <StateMessage compact level={3} title="Nenhum pedido nesta condição" description="Altere o filtro para ver pedidos em outra situação." />
      : <ul className="bling-order-list">
        {orders.map((order) => {
          const errorCode = order.lastErrorCode || order.jobError;
          return <li className="bling-order-row" key={order.orderId}>
            <div className="bling-order-main">
              <div className="bling-order-title">
                <Code>{order.publicCode}</Code>
                <StatusLabel tone={erpTone(order.erpStatus)}>{statusLabels[order.erpStatus] ?? order.erpStatus}</StatusLabel>
                <StatusLabel tone={invoiceTone(order.invoiceStatus)}>{statusLabels[order.invoiceStatus] ?? order.invoiceStatus}</StatusLabel>
              </div>
              {order.externalOrderId ? <small>Pedido Bling <Code>#{order.externalOrderId}</Code></small> : null}
              {errorCode ? <p className="bling-order-error"><AlertTriangle aria-hidden="true" /><span>{errorLabels[order.lastErrorCode ?? order.jobError ?? ""] ?? "Verifique os dados e a conexão do Bling."}</span></p> : null}
              {order.history?.length ? <details className="bling-order-history"><summary>Histórico de processamento</summary><ul>
                {order.history.map((item, index) => <li key={`${item.occurred_at}:${index}`}>
                  Tentativa <span className="ui-num">{item.attempt}</span> · {item.outcome === "completed" ? "Concluída" : item.outcome === "retry" ? "Reagendada" : "Falhou"}
                  {item.error_code ? ` · ${errorLabels[item.error_code] ?? "Revise a integração"}` : ""}
                </li>)}
              </ul></details> : null}
            </div>
            {!readOnly ? <div className="bling-order-actions">
              {order.erpStatus === "synced" && ["not_requested", "pending", "awaiting_data", "error"].includes(order.invoiceStatus) ? <button className="secondary-button" type="button"
                disabled={Boolean(processing)} onClick={() => void retry(order.orderId, "prepare")}>Preparar NF-e</button> : null}
              {order.erpStatus === "synced" && order.invoiceStatus === "pending" ? <button className="secondary-button" type="button"
                disabled={Boolean(processing)} onClick={() => void retry(order.orderId, "send")}>Solicitar emissão</button> : null}
              {["pending", "processing", "rejected", "error", "authorized"].includes(order.invoiceStatus) ? <button className="secondary-button" type="button"
                disabled={Boolean(processing)} onClick={() => void retry(order.orderId, "consult")}>Consultar NF-e</button> : null}
              {order.erpStatus !== "reconciliation_required" && order.jobStatus === "failed" ? <button className="secondary-button" type="button"
                disabled={Boolean(processing)} onClick={() => void retry(order.orderId)}>{processing === order.orderId ? <RefreshCw className="spin" aria-hidden="true" /> : null}Tentar novamente</button> : null}
              <button className="secondary-button" type="button" disabled={Boolean(processing)}
                onClick={() => void retry(order.orderId, "reconcile")}>Consultar e conciliar</button>
            </div> : null}
          </li>;
        })}
      </ul>}
  </section>;
}
