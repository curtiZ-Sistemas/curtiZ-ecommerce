"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { status: string; connected: boolean; environment: string; companyName: string | null;
  apiCheckedAt: string | null; apiHealthy: boolean | null; scopeSetup: string[];
  accessTokenExpiresAt: string | null; webhookConfigured: boolean; webhookStale: boolean;
  orderSyncEnabled: boolean; invoiceSyncEnabled: boolean; invoiceSendEnabled: boolean; fiscalReady: boolean;
  productSyncEnabled: boolean; productCreateEnabled: boolean;
  stockSyncEnabled: boolean; stockDepositConfigured: boolean;
  metrics: { queued?: number; running?: number; failed?: number; ordersSynced?: number;
    ordersPending?: number; productsMatched?: number; lastWebhookAt?: string | null; lastSyncAt?: string | null } };
type Preview = { page: number; rows: Array<{ sku: string; name: string; externalProductId: number;
  localVariantId: string | null; status: string }>; digest: string; hasMore: boolean };
type LocalPreview = { page: number; rows: Array<{ id: string; sku: string; active: boolean; linked: boolean }>;
  hasMore: boolean };
const labels: Record<string, string> = {
  not_configured: "Não configurado", awaiting_connection: "Aguardando conexão",
  connected: "Conectado", token_expiring: "Token expirando",
  reconnect_required: "Reconexão necessária", webhook_pending: "Webhook pendente",
  degraded: "Sincronização degradada"
};
const dateTime = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value))
  ? new Date(value).toLocaleString("pt-BR") : "Ainda não disponível";

export function BlingIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [localPreview, setLocalPreview] = useState<LocalPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/integrations/bling/status", { cache: "no-store" });
      const result = await response.json() as Status & { message?: string };
      if (!response.ok) throw new Error(result.message || "Status indisponível.");
      setStatus(result);
    } catch (failure) { setStatus(null); setError(failure instanceof Error ? failure.message : "Status indisponível."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/bling/connect", { method: "POST" });
      const result = await response.json() as { authorizationUrl?: string; message?: string };
      if (!response.ok || !result.authorizationUrl
        || new URL(result.authorizationUrl).origin !== "https://www.bling.com.br")
        throw new Error(result.message || "Não foi possível iniciar a conexão.");
      window.location.assign(result.authorizationUrl);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Conexão indisponível."); setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar o Bling? Jobs pendentes continuarão guardados para reconciliação.")) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/bling/disconnect", { method: "POST" });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Não foi possível desconectar.");
      setMessage("Bling desconectado."); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Desconexão indisponível."); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/bling/status", { method: "POST" });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Teste indisponível.");
      setMessage("Comunicação com o Bling confirmada."); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Teste indisponível."); }
    finally { setBusy(false); }
  };

  const loadPreview = async (nextPage = page) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/integrations/bling/products?page=${nextPage}`, { cache: "no-store" });
      const result = await response.json() as Preview & { message?: string };
      if (!response.ok) throw new Error(result.message || "Prévia indisponível.");
      setPreview(result); setPage(nextPage);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Prévia indisponível."); }
    finally { setBusy(false); }
  };

  const loadLocalPreview = async (nextPage = 1) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/integrations/bling/products?source=local&page=${nextPage}`, { cache: "no-store" });
      const result = await response.json() as LocalPreview & { message?: string };
      if (!response.ok) throw new Error(result.message || "Prévia local indisponível.");
      setLocalPreview(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Prévia local indisponível."); }
    finally { setBusy(false); }
  };

  const createProduct = async (variantId: string) => {
    if (!window.confirm("Verificar o SKU no Bling e criar o produto apenas se ele não existir?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/bling/products", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", variantId }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Solicitação indisponível.");
      setMessage("Sincronização solicitada. O Bling será consultado antes de qualquer criação.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Solicitação indisponível."); }
    finally { setBusy(false); }
  };

  const match = async () => {
    if (!preview || !window.confirm(`Vincular os SKUs correspondentes da página ${preview.page}?`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/bling/products", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ page: preview.page, digest: preview.digest }) });
      const result = await response.json() as { matched?: number; message?: string };
      if (!response.ok) throw new Error(result.message || "Correspondência não concluída.");
      setMessage(`${result.matched ?? 0} SKU(s) vinculados. Nenhum produto foi criado no Bling.`);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Correspondência não concluída."); }
    finally { setBusy(false); }
  };

  return <section className="panel-card technical-section bling-integration" aria-busy={loading || busy}>
    <h2>Bling</h2>
    {loading ? <p role="status">Carregando status do Bling…</p> : error && !status ? <p role="alert">{error} <button type="button" onClick={() => void load()}>Tentar novamente</button></p> : null}
    {status ? <>
      <p role="status"><strong>{labels[status.status] ?? status.status}</strong> · {status.environment === "production" ? "Produção" : "Aplicação de teste · API real do Bling"}</p>
      <div className="technical-runtime-grid">
        <div><strong>API</strong><span>{status.apiHealthy === true ? "Último teste confirmado" : status.apiHealthy === false ? "Último teste falhou" : "Ainda não testada"} · {dateTime(status.apiCheckedAt)}</span></div>
        <div><strong>Empresa</strong><span>{status.companyName ?? "Não verificada"}</span></div>
        <div><strong>Token</strong><span>{dateTime(status.accessTokenExpiresAt)}</span></div>
        <div><strong>Webhook</strong><span>{status.webhookConfigured ? status.webhookStale ? "Sem eventos recentes" : "Configurado" : "Pendente"}</span></div>
        <div><strong>Último evento</strong><span>{dateTime(status.metrics.lastWebhookAt)}</span></div>
        <div><strong>Última sincronização</strong><span>{dateTime(status.metrics.lastSyncAt)}</span></div>
        <div><strong>Fila</strong><span>{status.metrics.queued ?? 0} pendente(s), {status.metrics.running ?? 0} em execução, {status.metrics.failed ?? 0} falha(s)</span></div>
        <div><strong>Pedidos</strong><span>{status.metrics.ordersSynced ?? 0} sincronizado(s), {status.metrics.ordersPending ?? 0} pendente(s)</span></div>
        <div><strong>Variantes vinculadas</strong><span>{status.metrics.productsMatched ?? 0}</span></div>
      </div>
      <p className="technical-note">Permissões a conferir no aplicativo Bling: {status.scopeSetup.join(", ")}.</p>
      <p className="technical-note">Produtos: {status.productSyncEnabled ? "atualização habilitada" : "atualização desabilitada"}. Estoque: {status.stockSyncEnabled ? "envio habilitado" : "envio desabilitado"}{status.stockDepositConfigured ? "" : " (depósito pendente)"}. Pedidos: {status.orderSyncEnabled ? "envio habilitado" : "envio desabilitado"}. Rascunho fiscal: {status.invoiceSyncEnabled ? "habilitado" : "desabilitado"}. Envio à SEFAZ: {status.invoiceSendEnabled ? "habilitado" : "desabilitado"}. Dados fiscais: {status.fiscalReady ? "confirmados no ambiente" : "aguardando conferência"}.</p>
      <div className="table-actions">
        {status.connected ? <>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void test()}>Testar conexão</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void connect()}>Reconectar</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void disconnect()}>Desconectar</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadPreview(1)}>Conferir SKUs</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadLocalPreview(1)}>Variantes locais</button>
        </> : <button className="primary-button" type="button" disabled={busy || status.status === "not_configured"} onClick={() => void connect()}>Conectar Bling</button>}
      </div>
      {preview ? <div className="technical-section">
        <h3>Prévia de SKUs · página {preview.page}</h3>
        {preview.rows.length ? <div className="admin-compact-list">{preview.rows.map((item) => <div key={`${item.sku}-${item.externalProductId}`}>
          <span><strong>{item.sku}</strong><small>{item.name}</small></span>
          <span>{item.status === "ready_to_match" ? "Correspondência encontrada" : item.status === "duplicate_external_sku" ? "SKU duplicado no Bling" : "Sem variante local"}</span>
        </div>)}</div> : <p>Nenhum produto nesta página.</p>}
        <div className="table-actions">
          <button className="primary-button" type="button" disabled={busy || !preview.rows.some((item) => item.status === "ready_to_match")} onClick={() => void match()}>Vincular correspondências</button>
          <button className="secondary-button" type="button" disabled={busy || page <= 1} onClick={() => void loadPreview(page - 1)}>Anterior</button>
          <button className="secondary-button" type="button" disabled={busy || !preview.hasMore} onClick={() => void loadPreview(page + 1)}>Próxima</button>
        </div>
      </div> : null}
      {localPreview ? <div className="technical-section">
        <h3>Variantes locais · página {localPreview.page}</h3>
        {localPreview.rows.length ? <div className="admin-compact-list">{localPreview.rows.map((item) => <div key={item.id}>
          <span><strong>{item.sku}</strong><small>{item.linked ? "Vinculado ao Bling" : "Sem vínculo confirmado"}</small></span>
          {!item.linked && status.productCreateEnabled ? <button className="secondary-button" type="button" disabled={busy}
            onClick={() => void createProduct(item.id)}>Sincronizar</button> : null}
        </div>)}</div> : <p>Nenhuma variante nesta página.</p>}
        {!status.productCreateEnabled ? <p className="technical-note">Criação controlada desabilitada neste ambiente.</p> : null}
        <div className="table-actions">
          <button className="secondary-button" type="button" disabled={busy || localPreview.page <= 1}
            onClick={() => void loadLocalPreview(localPreview.page - 1)}>Anterior</button>
          <button className="secondary-button" type="button" disabled={busy || !localPreview.hasMore}
            onClick={() => void loadLocalPreview(localPreview.page + 1)}>Próxima</button>
        </div>
      </div> : null}
    </> : null}
    {message ? <p role="status" className="admin-feedback">{message}</p> : null}
    {error && status ? <p role="alert" className="admin-feedback">{error}</p> : null}
  </section>;
}
