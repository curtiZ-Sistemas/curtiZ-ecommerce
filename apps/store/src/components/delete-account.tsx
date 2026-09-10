"use client";

import { useEffect, useRef, useState } from "react";
import { clearClientSessionState } from "@/lib/session-persistence-client";
import { isUnknownRecord, readString } from "@/lib/unknown-data";

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (token && !pending) confirm.current?.focus(); }, [token, pending]);
  async function submit(body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/customer/delete-account", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      const payload: unknown = await response.json();
      const result = isUnknownRecord(payload) ? payload : {};
      if (!response.ok) {
        if (response.status === 403 && body.action === "confirm") setToken("");
        setError(readString(result, "message", "Não conseguimos concluir. Tente novamente.")); return;
      }
      if (typeof result.token === "string") {
        setToken(result.token);
      } else if (result.ok === true) {
        clearClientSessionState();
        localStorage.removeItem("curtiz-demo-cart");
        localStorage.setItem("curtiz-account-closed", new Date().toISOString());
        window.location.replace("/login?account=deleted");
      } else setError("Não conseguimos confirmar o resultado. Tente novamente.");
    } catch { setError("Não conseguimos confirmar a operação. Verifique sua conexão antes de tentar novamente."); }
    finally { lock.current = false; setPending(false); }
  }
  return <article className="customer-panel">
    <h3>Excluir minha conta</h3>
    <p>Seu acesso será excluído e seu carrinho será apagado. Registros de pedidos e obrigações de atendimento serão preservados.</p>
    {!open ? <button className="customer-link-button danger" onClick={() => setOpen(true)}>Excluir minha conta</button> : <>
      {token ? <div role="group" aria-label="Confirmar exclusão da conta">
        <p><strong>Tem certeza de que deseja excluir sua conta? Esta ação não pode ser desfeita.</strong></p>
        <button ref={confirm} className="primary-button" disabled={pending} onClick={() => void submit({ action: "confirm", token, confirmed: true })}>Sim, excluir minha conta</button>
      </div> : <form onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const value = new FormData(form).get("password");
        const password = typeof value === "string" ? value : "";
        form.reset();
        void submit({ action: "verify", password });
      }}>
        <label className="customer-field"><span>Senha atual</span><input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={pending} /></label>
        <p>Se entrou com Google e ainda não definiu uma senha, use “Alterar senha” primeiro.</p>
        <button className="secondary-button" disabled={pending}>Continuar</button>
      </form>}
      <button className="customer-link-button" disabled={pending} onClick={() => { setOpen(false); setToken(""); setError(""); }}>Cancelar</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </article>;
}
