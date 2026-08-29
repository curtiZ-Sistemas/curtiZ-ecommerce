"use client";

import { ArrowLeft, LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";

function browserStoreOrigin(configuredStoreUrl: string) {
  const configured = new URL(configuredStoreUrl);
  const current = new URL(window.location.href);
  const configuredIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(configured.hostname);
  const currentIsLoopback = ["localhost", "127.0.0.1", "::1"].includes(current.hostname);
  return configuredIsLoopback && !currentIsLoopback
    ? `${current.protocol}//${current.hostname}:3000`
    : configured.origin;
}

export function PanelSelectorLogout({
  storeUrl,
  fallbackHref
}: {
  storeUrl: string;
  fallbackHref: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const logout = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const origin = browserStoreOrigin(storeUrl);
      const response = await fetch(`${origin}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("logout_failed");
      window.location.assign(`${origin}/login`);
    } catch {
      setError("Não foi possível sair da conta. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <div className="panel-selector-logout">
      <button
        className="panel-selector-back"
        type="button"
        onClick={() => {
          const referrer = document.referrer ? new URL(document.referrer) : null;
          if (
            referrer?.origin === window.location.origin &&
            referrer.pathname !== window.location.pathname
          ) {
            window.history.back();
            return;
          }
          window.location.assign(fallbackHref);
        }}
      >
        <ArrowLeft aria-hidden="true" /> Voltar
      </button>
      <button type="button" onClick={() => void logout()} disabled={loading}>
        {loading ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <LogOut aria-hidden="true" />
        )}
        {loading ? "Saindo…" : "Sair da conta"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
