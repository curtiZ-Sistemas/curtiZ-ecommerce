"use client";

import { useState, type FormEvent } from "react";

export function RepresentativeKitMg02Approval() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/operations/representative-kits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_mg02",
          representativeCode: form.get("representativeCode"),
          document: form.get("document"),
          legalName: form.get("legalName"),
          stateRegistration: form.get("stateRegistration"),
          fiscalAddress: {
            state: "MG", postal_code: form.get("postalCode"), street: form.get("street"),
            number: form.get("number"), district: form.get("district"), city: form.get("city")
          },
          buyerEvidence: form.get("buyerEvidence"),
          operationEvidence: form.get("operationEvidence"),
          stockEvidence: form.get("stockEvidence"),
          homologationEvidence: form.get("homologationEvidence"),
          validUntil: new Date(String(form.get("validUntil"))).toISOString()
        })
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("approvedRuleVersions" in result)
        || typeof result.approvedRuleVersions !== "number") throw new Error("approval_unavailable");
      setSuccess(`Conta habilitada para ${result.approvedRuleVersions} regras atuais de kits MG02.`);
      formElement.reset();
    } catch {
      setError("Não foi possível habilitar a conta. Confira os dados, a permissão e as referências reais.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="op-surface">
    <summary>Habilitar conta de representante MG02</summary>
    <p>Use somente dados conferidos e referências reais. Não informe protocolo, XML ou parecer que não esteja disponível.</p>
    <form onSubmit={submit}>
      <label>Código do representante <input required name="representativeCode" placeholder="REP-0123ABCDEF" pattern="REP-[A-Fa-f0-9]{10}" maxLength={14} /></label>
      <label>CNPJ <input required name="document" inputMode="numeric" pattern="[0-9]{14}" maxLength={14} /></label>
      <label>Razão social <input required name="legalName" minLength={2} maxLength={180} /></label>
      <label>Inscrição estadual de MG <input required name="stateRegistration" inputMode="numeric" pattern="[0-9]{2,14}" maxLength={14} /></label>
      <fieldset>
        <legend>Endereço fiscal em MG</legend>
        <label>CEP <input required name="postalCode" inputMode="numeric" pattern="3[0-9]{7}" maxLength={8} /></label>
        <label>Rua <input required name="street" maxLength={180} /></label>
        <label>Número <input required name="number" maxLength={30} /></label>
        <label>Bairro <input required name="district" maxLength={100} /></label>
        <label>Cidade <input required name="city" maxLength={100} /></label>
      </fieldset>
      <label>Referência da conferência cadastral <input required name="buyerEvidence" minLength={10} maxLength={500} /></label>
      <label>Referência da conferência da operação <input required name="operationEvidence" minLength={10} maxLength={500} /></label>
      <label>Referência da conferência do estoque <input required name="stockEvidence" minLength={10} maxLength={500} /></label>
      <label>Referência da homologação relatada <input required name="homologationEvidence" minLength={10} maxLength={500} /></label>
      <label>Validade da aprovação <input required name="validUntil" type="datetime-local" /></label>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}
      <button type="submit" disabled={busy}>{busy ? "Salvando…" : "Registrar aprovação MG02"}</button>
    </form>
  </details>;
}
