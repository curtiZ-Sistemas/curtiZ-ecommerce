"use client";

import { useCallback, useEffect, useState } from "react";

type Order = { orderId: string; publicCode: string; externalOrderId: number | null; invoiceId: number | null;
  erpStatus: string; invoiceStatus: string; lastErrorCode: string | null;
  jobStatus: string | null; jobError: string | null; placed_at: string | null;
  history?: Array<{ attempt: number; outcome: string; error_code: string | null; occurred_at: string }> };
const errorLabels: Record<string, string> = {
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
  const retry = async (orderId: string, action: "retry" | "reconcile" = "retry") => {
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
  return <section className="panel-card bling-console" aria-busy={loading}>
    <header className="dashboard-section-heading compact"><div><span>Integração</span><h2>Pedidos no Bling</h2></div></header>
    <label>Filtrar pendências <select value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="all">Todos</option><option value="pending">Aguardando ERP</option>
      <option value="failed">Falhas</option><option value="invoice">Aguardando nota</option>
    </select></label>
    {loading ? <p role="status">Carregando integração…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => void load(filter)}>Tentar novamente</button></p>
      : !orders.length ? <p>Nenhum pedido nesta condição.</p> : <div className="operational-list">
        {orders.map((order) => <article className="bling-order-row" key={order.orderId}>
          <strong>{order.publicCode}</strong>
          <span className={`status ${order.erpStatus === "synced" ? "green" : order.erpStatus === "failed" || order.erpStatus === "reconciliation_required" ? "red" : "yellow"}`}>
            {statusLabels[order.erpStatus] ?? order.erpStatus}</span>
          <span>{statusLabels[order.invoiceStatus] ?? order.invoiceStatus}</span>
          {order.externalOrderId ? <small>Pedido Bling #{order.externalOrderId}</small> : null}
          {order.lastErrorCode || order.jobError ? <p>{errorLabels[order.lastErrorCode ?? order.jobError ?? ""] ?? "Verifique os dados e a conexão do Bling."}</p> : null}
          {order.history?.length ? <details><summary>Histórico de processamento</summary><ul>
            {order.history.map((item, index) => <li key={`${item.occurred_at}:${index}`}>
              Tentativa {item.attempt} · {item.outcome === "completed" ? "Concluída" : item.outcome === "retry" ? "Reagendada" : "Falhou"}
              {item.error_code ? ` · ${errorLabels[item.error_code] ?? "Revise a integração"}` : ""}
            </li>)}
          </ul></details> : null}
          {!readOnly && order.erpStatus !== "reconciliation_required" && order.jobStatus === "failed" ? <button className="secondary-button" type="button"
            disabled={Boolean(processing)} onClick={() => void retry(order.orderId)}>Tentar novamente</button> : null}
          {!readOnly ? <button className="secondary-button" type="button" disabled={Boolean(processing)}
            onClick={() => void retry(order.orderId, "reconcile")}>Consultar e conciliar</button> : null}
        </article>)}
      </div>}
    {message ? <p role="status" className="admin-feedback">{message}</p> : null}
  </section>;
}
