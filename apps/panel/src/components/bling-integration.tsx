"use client";

import { useCallback, useEffect, useState } from "react";
import { usePanelConfirm } from "./panel-prompt";
import { LoadingBlock, SectionHeader, StateMessage, StatusLabel, type UiTone } from "./panel-ui";

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
const tones: Record<string, UiTone> = {
  connected: "success", token_expiring: "warning", reconnect_required: "danger",
  webhook_pending: "warning", degraded: "warning"
};
const dateTime = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value))
  ? new Date(value).toLocaleString("pt-BR") : "Ainda não disponível";

export function BlingIntegration() {
  const confirm = usePanelConfirm();
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

  const connect = async (reconnect: boolean) => {
    const confirmed = await confirm(reconnect
      ? { title: "Reconectar o Bling?", description: "Você será levado ao Bling para autorizar a integração de novo.", confirmLabel: "Reconectar" }
      : { title: "Conectar o Bling?", description: "Você será levado ao Bling para autorizar a integração.", confirmLabel: "Conectar" });
    if (!confirmed) return;
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
    const confirmed = await confirm({ title: "Desconectar o Bling?",
      description: "Jobs pendentes continuarão guardados para reconciliação.", confirmLabel: "Desconectar", tone: "danger" });
    if (!confirmed) return;
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
    const confirmed = await confirm({ title: "Testar a comunicação com o Bling?",
      description: "Uma chamada real à API do Bling será feita e o resultado do teste aparecerá no status.", confirmLabel: "Testar" });
    if (!confirmed) return;
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
    const confirmed = await confirm({ title: "Sincronizar esta variante com o Bling?",
      description: "O SKU será verificado no Bling e o produto só será criado se ele não existir.", confirmLabel: "Sincronizar" });
    if (!confirmed) return;
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

  const runCatalogBatch = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/integrations/bling/catalog/run", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 4 }) });
      const result = await response.json() as { ok?: boolean; processed?: number; failed?: number; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "O lote encontrou uma falha. Confira as pendências antes de continuar.");
      setMessage(`${result.processed ?? 0} tarefa(s) de catálogo concluída(s).`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Lote indisponível."); }
    finally { setBusy(false); }
  };

  const match = async () => {
    if (!preview) return;
    const confirmed = await confirm({ title: `Vincular os SKUs correspondentes da página ${preview.page}?`,
      description: "Somente as correspondências encontradas nesta página serão vinculadas. Nenhum produto é criado no Bling.",
      confirmLabel: "Vincular" });
    if (!confirmed) return;
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

  const previewStatus = (value: string) => value === "ready_to_match"
    ? <StatusLabel tone="success">Correspondência encontrada</StatusLabel>
    : value === "duplicate_external_sku"
      ? <StatusLabel tone="warning">SKU duplicado no Bling</StatusLabel>
      : <StatusLabel>Sem variante local</StatusLabel>;

  return <section className="technical-section bling-integration" aria-labelledby="technical-bling" aria-busy={loading || busy}>
    <SectionHeader id="technical-bling" title="Bling" />
    <div className="technical-sheet">
      {loading ? <LoadingBlock label="Carregando status do Bling…" rows={3} /> : error && !status
        ? <StateMessage compact kind="error" level={3} title="Status do Bling indisponível" description={error}
          action={<button className="secondary-button" type="button" onClick={() => void load()}>Tentar novamente</button>} />
        : null}
      {status ? <>
        <p className="technical-lead" role="status"><StatusLabel tone={tones[status.status] ?? "neutral"}>{labels[status.status] ?? status.status}</StatusLabel> <span>{status.environment === "production" ? "Produção" : "Aplicação de teste · API real do Bling"}</span></p>
        <dl className="technical-facts">
          <div><dt>API</dt><dd>{status.apiHealthy === true ? "Último teste confirmado" : status.apiHealthy === false ? "Último teste falhou" : "Ainda não testada"} · <span className="ui-num">{dateTime(status.apiCheckedAt)}</span></dd></div>
          <div><dt>Empresa</dt><dd>{status.companyName ?? "Não verificada"}</dd></div>
          <div><dt>Token</dt><dd className="ui-num">{dateTime(status.accessTokenExpiresAt)}</dd></div>
          <div><dt>Webhook</dt><dd>{status.webhookConfigured ? status.webhookStale ? "Sem eventos recentes" : "Configurado" : "Pendente"}</dd></div>
          <div><dt>Último evento</dt><dd className="ui-num">{dateTime(status.metrics.lastWebhookAt)}</dd></div>
          <div><dt>Última sincronização</dt><dd className="ui-num">{dateTime(status.metrics.lastSyncAt)}</dd></div>
          <div><dt>Fila</dt><dd className="ui-num">{status.metrics.queued ?? 0} pendente(s), {status.metrics.running ?? 0} em execução, {status.metrics.failed ?? 0} falha(s)</dd></div>
          <div><dt>Pedidos</dt><dd className="ui-num">{status.metrics.ordersSynced ?? 0} sincronizado(s), {status.metrics.ordersPending ?? 0} pendente(s)</dd></div>
          <div><dt>Variantes vinculadas</dt><dd className="ui-num">{status.metrics.productsMatched ?? 0}</dd></div>
        </dl>
        <h3 className="technical-subheading">Sincronizações</h3>
        <dl className="technical-facts">
          <div><dt>Produtos</dt><dd>{status.productSyncEnabled ? "Atualização habilitada" : "Atualização desabilitada"}</dd></div>
          <div><dt>Estoque</dt><dd>{status.stockSyncEnabled ? "Envio habilitado" : "Envio desabilitado"}{status.stockDepositConfigured ? "" : " (depósito pendente)"}</dd></div>
          <div><dt>Pedidos</dt><dd>{status.orderSyncEnabled ? "Envio habilitado" : "Envio desabilitado"}</dd></div>
          <div><dt>Rascunho fiscal</dt><dd>{status.invoiceSyncEnabled ? "Habilitado" : "Desabilitado"}</dd></div>
          <div><dt>Envio à SEFAZ</dt><dd>{status.invoiceSendEnabled ? "Habilitado" : "Desabilitado"}</dd></div>
          <div><dt>Dados fiscais</dt><dd>{status.fiscalReady ? "Confirmados no ambiente" : "Aguardando conferência"}</dd></div>
        </dl>
        <p className="technical-note">Permissões a conferir no aplicativo Bling: {status.scopeSetup.join(", ")}.</p>
        {message ? <p role="status" className="admin-feedback success technical-inline-feedback">{message}</p> : null}
        {error ? <p role="alert" className="admin-feedback error technical-inline-feedback">{error}</p> : null}
        <div className="technical-actions">
          {status.connected ? <>
            <div className="technical-actions-group">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void test()}>Testar conexão</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadPreview(1)}>Conferir SKUs</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadLocalPreview(1)}>Variantes locais</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void runCatalogBatch()}>Processar lote de catálogo</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => void connect(true)}>Reconectar</button>
            </div>
            <button className="secondary-button technical-danger-action" type="button" disabled={busy} onClick={() => void disconnect()}>Desconectar</button>
          </> : <div className="technical-actions-group">
            <button className="primary-button" type="button" disabled={busy || status.status === "not_configured"} onClick={() => void connect(false)}>Conectar Bling</button>
          </div>}
        </div>
        {preview ? <div className="technical-subsection">
          <h3 className="technical-subheading">Prévia de SKUs · página {preview.page}</h3>
          {preview.rows.length ? <table className="data-table ui-table-stack technical-table">
            <thead><tr><th scope="col">SKU</th><th scope="col">Produto no Bling</th><th scope="col">Resultado</th></tr></thead>
            <tbody>{preview.rows.map((item) => <tr key={`${item.sku}-${item.externalProductId}`}>
              <td data-label="SKU"><code className="ui-code">{item.sku}</code></td>
              <td data-label="Produto no Bling" className="technical-wrap">{item.name}</td>
              <td data-label="Resultado">{previewStatus(item.status)}</td>
            </tr>)}</tbody>
          </table> : <StateMessage compact level={3} title="Nenhum produto nesta página." />}
          <div className="technical-actions">
            <div className="technical-actions-group">
              <button className="primary-button" type="button" disabled={busy || !preview.rows.some((item) => item.status === "ready_to_match")} onClick={() => void match()}>Vincular correspondências</button>
            </div>
            <div className="technical-actions-group">
              <button className="secondary-button" type="button" disabled={busy || page <= 1} onClick={() => void loadPreview(page - 1)}>Anterior</button>
              <button className="secondary-button" type="button" disabled={busy || !preview.hasMore} onClick={() => void loadPreview(page + 1)}>Próxima</button>
            </div>
          </div>
        </div> : null}
        {localPreview ? <div className="technical-subsection">
          <h3 className="technical-subheading">Variantes locais · página {localPreview.page}</h3>
          {localPreview.rows.length ? <table className="data-table ui-table-stack technical-table">
            <thead><tr><th scope="col">SKU</th><th scope="col">Vínculo</th>{status.productCreateEnabled ? <th scope="col"><span className="sr-only">Ações</span></th> : null}</tr></thead>
            <tbody>{localPreview.rows.map((item) => <tr key={item.id}>
              <td data-label="SKU"><code className="ui-code">{item.sku}</code></td>
              <td data-label="Vínculo">{item.linked ? <StatusLabel tone="success">Vinculado ao Bling</StatusLabel> : <StatusLabel>Sem vínculo confirmado</StatusLabel>}</td>
              {status.productCreateEnabled ? <td className="technical-row-actions">{!item.linked ? <button className="secondary-button" type="button" disabled={busy}
                onClick={() => void createProduct(item.id)}>Sincronizar</button> : null}</td> : null}
            </tr>)}</tbody>
          </table> : <StateMessage compact level={3} title="Nenhuma variante nesta página." />}
          {!status.productCreateEnabled ? <p className="technical-note">Criação controlada desabilitada neste ambiente.</p> : null}
          <div className="technical-actions">
            <div className="technical-actions-group">
              <button className="secondary-button" type="button" disabled={busy || localPreview.page <= 1}
                onClick={() => void loadLocalPreview(localPreview.page - 1)}>Anterior</button>
              <button className="secondary-button" type="button" disabled={busy || !localPreview.hasMore}
                onClick={() => void loadLocalPreview(localPreview.page + 1)}>Próxima</button>
            </div>
          </div>
        </div> : null}
      </> : null}
      {!status && message ? <p role="status" className="admin-feedback success technical-inline-feedback">{message}</p> : null}
    </div>
  </section>;
}
