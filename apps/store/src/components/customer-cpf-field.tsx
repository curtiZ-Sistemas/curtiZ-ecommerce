"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CPF_FORMATTED_MAX_LENGTH, formatCpf, isValidCpf, sanitizeCpf } from "../lib/personal-data";
import { isUnknownRecord } from "../lib/unknown-data";

export function CustomerCpfField({ lastFour, onSaved, onEditingChange }: {
  lastFour: string;
  onSaved?: (lastFour: string) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const id = useId();
  const [savedLastFour, setSavedLastFour] = useState(lastFour);
  const [editing, setEditing] = useState(false);
  const [cpf, setCpf] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  useEffect(() => { setSavedLastFour(lastFour); }, [lastFour]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  const toggle = (value: boolean) => {
    setCpf(""); setMessage(""); setEditing(value); onEditingChange?.(value);
    if (!value) changeButton.current?.focus();
  };
  const save = async () => {
    if (saving.current) return;
    if (!isValidCpf(cpf)) { setMessage("Informe um CPF válido."); input.current?.focus(); return; }
    saving.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch("/api/customer/cpf", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cpf: sanitizeCpf(cpf) })
      });
      const result: unknown = await response.json();
      if (!response.ok || !isUnknownRecord(result) || result.ok !== true
        || typeof result.cpfLastFour !== "string" || !/^\d{4}$/u.test(result.cpfLastFour)) {
        setMessage("Não foi possível salvar o CPF. Tente novamente."); return;
      }
      setSavedLastFour(result.cpfLastFour); onSaved?.(result.cpfLastFour);
      toggle(false); setMessage("CPF atualizado.");
    } catch {
      setMessage("Não foi possível salvar o CPF. Tente novamente.");
    } finally {
      saving.current = false; setPending(false);
    }
  };

  return <div>
    <div className="customer-readonly">CPF {savedLastFour ? `•••.•••.•••-${savedLastFour}` : "não informado"}</div>
    <button ref={changeButton} className="secondary-button" type="button" aria-expanded={editing}
      aria-controls={`${id}-editor`} disabled={pending} onClick={() => toggle(!editing)}>
      {editing ? "Cancelar" : savedLastFour ? "Alterar" : "Adicionar CPF"}
    </button>
    {editing && <div id={`${id}-editor`}>
      <label htmlFor={id}>Novo CPF completo</label>
      <input ref={input} id={id} value={cpf} inputMode="numeric" autoComplete="off"
        maxLength={CPF_FORMATTED_MAX_LENGTH} disabled={pending} aria-describedby={`${id}-message`}
        onChange={event => { setCpf(formatCpf(event.target.value)); setMessage(""); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
      <button className="secondary-button" type="button" disabled={pending} onClick={() => void save()}>
        {pending ? "Salvando CPF…" : "Salvar CPF"}
      </button>
    </div>}
    <p id={`${id}-message`} role="status">{message}</p>
  </div>;
}
