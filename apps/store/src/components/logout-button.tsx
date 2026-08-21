"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { clearClientSessionState } from "@/lib/session-persistence-client";

export function LogoutButton({ className = "" }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const logout = async () => {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const result = (await response.json()) as { redirectTo?: string };
      if (!response.ok) throw new Error("logout_failed");
      clearClientSessionState();
      window.location.assign(result.redirectTo ?? "/login");
    } catch {
      setError("Não foi possível sair agora. Tente novamente.");
      setLoading(false);
    }
  };

  return (
    <div className="logout-control">
      <button
        className={className}
        type="button"
        onClick={() => {
          void logout();
        }}
        disabled={loading}
      >
        {loading ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <LogOut aria-hidden="true" />
        )}
        {loading ? "Saindo…" : "Sair da conta"}
      </button>
      {error && (
        <span className="logout-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
