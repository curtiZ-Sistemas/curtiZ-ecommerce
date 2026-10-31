"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";
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
  const restoreFocus = useRef(false);
  useEffect(() => { setSavedLastFour(lastFour); }, [lastFour]);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (restoreFocus.current) { changeButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);

  const toggle = (value: boolean) => {
    setCpf(""); setMessage(""); setEditing(value); onEditingChange?.(value);
    if (!value) restoreFocus.current = true;
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

  return <div className="customer-cpf-field">
    <label htmlFor={id}>CPF</label>
    <div className="customer-cpf-input">
      {editing ? <input ref={input} id={id} value={cpf} inputMode="numeric" autoComplete="off"
        placeholder="000.000.000-00"
        maxLength={CPF_FORMATTED_MAX_LENGTH} disabled={pending} aria-describedby={`${id}-message`}
        onChange={event => { setCpf(formatCpf(event.target.value)); setMessage(""); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
        : <><input id={id} readOnly value={savedLastFour ? `•••.•••.•••-${savedLastFour}` : "Não informado"} />
          <button ref={changeButton} className="customer-cpf-edit" type="button" aria-label="Alterar CPF"
            onClick={() => toggle(true)}><Pencil size={16} aria-hidden="true" /></button></>}
    </div>
    {editing && <div className="customer-cpf-actions">
      <button type="button" disabled={pending} onClick={() => toggle(false)}>Cancelar</button>
      <button type="button" disabled={pending || !isValidCpf(cpf)} onClick={() => void save()}>
        {pending ? "Salvando…" : "Salvar"}</button>
    </div>}
    <p id={`${id}-message`} role="status">{message}</p>
  </div>;
}
