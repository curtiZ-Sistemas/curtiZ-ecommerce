"use client";

import { useCallback, useEffect, useState } from "react";

type Variant = { variantId: string; sku: string; externalProductId: number | null; status: string; stockStatus?: string; errorCode: string | null };
const labels: Record<string, string> = { unlinked: "Sem vínculo", matched: "Vínculo confirmado", pending: "Sincronização pendente",
  synced: "Sincronizado", failed: "Falha na sincronização", reconciliation_required: "Conciliação necessária" };

export function BlingCatalogStatus({ productId }: { productId: string }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/integrations/bling/catalog?productId=${encodeURIComponent(productId)}`, { cache: "no-store" });
      const result = await response.json() as { variants?: Variant[]; message?: string };
      if (!response.ok || !Array.isArray(result.variants)) throw new Error(result.message || "Consulta indisponível.");
      setVariants(result.variants);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Consulta indisponível."); }
    finally { setLoading(false); }
  }, [productId]);
  useEffect(() => { void load(); }, [load]);
  const retry = async (variantId: string, action: "retry" | "reconcile" = "retry") => {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/integrations/bling/catalog", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, action }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Sincronização indisponível.");
      setMessage("Sincronização solicitada."); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sincronização indisponível."); }
    finally { setBusy(false); }
  };
  return <section className="bling-catalog-status" aria-busy={loading}>
    <h3>Integração Bling por SKU</h3>
    {loading ? <p role="status">Consultando sincronização…</p> : error ? <p role="alert">{error}
      <button type="button" onClick={() => void load()}>Tentar novamente</button></p> : !variants.length ? <p>Nenhuma variante salva.</p>
      : <ul>{variants.map((variant) => <li key={variant.variantId}>
        <strong>{variant.sku}</strong> · {labels[variant.status] || "Pendente"}
        {variant.stockStatus ? <small> · Estoque: {labels[variant.stockStatus] || "Pendente"}</small> : null}
        {variant.externalProductId ? <small> · Bling #{variant.externalProductId}</small> : null}
        {variant.errorCode ? <p>Revise o cadastro e a conexão no painel técnico.</p> : null}
        {variant.status === "failed" ? <button className="secondary-button" type="button" disabled={busy}
          onClick={() => void retry(variant.variantId)}>Tentar novamente</button> : null}
        {variant.status === "failed" || variant.status === "reconciliation_required" ? <button className="secondary-button" type="button" disabled={busy}
          onClick={() => void retry(variant.variantId, "reconcile")}>Consultar vínculo</button> : null}
      </li>)}</ul>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
