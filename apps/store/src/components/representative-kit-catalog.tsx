"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { readGradeCatalog, RepresentativeKitGrades, type GradeCatalog } from "./representative-kit-grades";
import { RepresentativeKitOrderHistory } from "./representative-kit-order";

export function RepresentativeKitCatalog({ header }: { header: ReactNode }) {
  const [catalog, setCatalog] = useState<GradeCatalog | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/representatives/kits/grades", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Kits indisponíveis.");
        const next = readGradeCatalog(await response.json() as unknown);
        if (!controller.signal.aborted) setCatalog(next);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);

  // Cancelling, paying or expiring an order changes the stock the offers show.
  const reloadOffers = useCallback(() => setRetry(value => value + 1), []);

  return <section className="representative-kit-catalog">
    <div className="representative-kit-catalog-head">
      {header}
      {catalog?.orderHistoryAvailable && <RepresentativeKitOrderHistory checkoutConfigured={catalog.checkoutConfigured}
        onOffersChanged={reloadOffers} />}
    </div>
    {catalog ? <RepresentativeKitGrades offers={catalog.offers} />
      : error ? <div role="alert" className="representative-kit-catalog-state">
        <p>Não foi possível carregar os kits. Tente novamente.</p>
        <button type="button" className="secondary-button" onClick={() => { setError(false); setRetry(value => value + 1); }}>Tentar novamente</button>
      </div>
        : <p className="representative-kit-catalog-state" role="status">Carregando kits…</p>}
  </section>;
}
