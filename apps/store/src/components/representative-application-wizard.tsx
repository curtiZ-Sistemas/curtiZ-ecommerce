"use client";

import { ArrowLeft, ArrowRight, Check, FileCheck2, LoaderCircle, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  CPF_FORMATTED_MAX_LENGTH,
  formatBrazilianPhone,
  formatCpf,
  isValidBrazilianPhone,
  isValidCpf,
  PHONE_FORMATTED_MAX_LENGTH
} from "@/lib/personal-data";

const steps = [
  "Dados pessoais",
  "Perfil comercial",
  "Indicação",
  "Documentos",
  "Termos",
  "Revisão"
] as const;

type Snapshot = {
  application?: {
    status: string;
    currentStep: number;
    reason?: string;
  } | null;
};

export function RepresentativeApplicationWizard() {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/representatives", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login?next=/representante/solicitacao");
          return null;
        }
        return response.ok ? ((await response.json()) as Snapshot) : null;
      })
      .then((snapshot) => {
        if (snapshot?.application) {
          setStep(Math.max(1, Math.min(6, snapshot.application.currentStep)));
          setStatus(snapshot.application.status);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const save = async (values: Record<string, string | boolean>, move = true) => {
    if (saving) return false;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save_draft", step, values })
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível salvar.");
      setMessage("Rascunho salvo.");
      if (move) setStep((current) => Math.min(6, current + 1));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 1) {
      const cpf = event.currentTarget.elements.namedItem("cpf");
      const phone = event.currentTarget.elements.namedItem("phone");
      if (cpf instanceof HTMLInputElement) {
        cpf.setCustomValidity(isValidCpf(cpf.value) ? "" : "Informe um CPF válido.");
      }
      if (phone instanceof HTMLInputElement) {
        phone.setCustomValidity(
          isValidBrazilianPhone(phone.value) ? "" : "Informe um telefone válido com DDD."
        );
      }
      if (!event.currentTarget.checkValidity()) {
        event.currentTarget.reportValidity();
        return;
      }
    }
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void save(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          value === "on" ? true : typeof value === "string" ? value : ""
        ])
      )
    );
  };

  const uploadDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/representatives/documents", {
        method: "POST",
        body: form
      });
      const result = (await response.json()) as { message?: string; name?: string };
      if (!response.ok) throw new Error(result.message ?? "Falha no envio.");
      setDocuments((current) => [...current, result.name ?? "Documento recebido"]);
      setMessage("Documento recebido e vinculado à solicitação.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no envio.");
    } finally {
      setSaving(false);
    }
  };

  const submitApplication = async () => {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/representatives", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit" })
      });
      const result = (await response.json()) as { message?: string; status?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível enviar.");
      setStatus(result.status ?? "submitted");
      setMessage("Solicitação enviada para análise.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="representative-wizard-loading" aria-label="Carregando solicitação">
        <LoaderCircle className="spin" />
      </div>
    );
  }

  if (!["draft", "documents_pending"].includes(status)) {
    return (
      <section className="application-status-state">
        <span>
          <FileCheck2 />
        </span>
        <p className="eyebrow">Solicitação {statusLabel(status)}</p>
        <h1>Acompanhe o andamento pelo seu perfil</h1>
        <p>As alterações, pedidos de correção e a decisão ficam registradas no histórico.</p>
        <a className="primary-button" href="/perfil">
          Voltar ao perfil
        </a>
      </section>
    );
  }

  return (
    <div className="representative-application-layout">
      <aside className="application-steps" aria-label="Etapas da solicitação">
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <button
              className={number === step ? "active" : number < step ? "complete" : ""}
              type="button"
              onClick={() => number <= step && setStep(number)}
              key={label}
            >
              <span>{number < step ? <Check /> : number}</span>
              {label}
            </button>
          );
        })}
      </aside>
      <section className="application-form-card">
        <header>
          <p className="eyebrow">Etapa {step} de 6</p>
          <h1>{steps[step - 1]}</h1>
          <p>Você pode salvar e continuar depois.</p>
        </header>
        {step === 1 && (
          <StepForm onSubmit={submitForm}>
            <Field label="Nome completo" name="fullName" autoComplete="name" required />
            <Field
              label="CPF"
              name="cpf"
              inputMode="numeric"
              placeholder="Somente números"
              maxLength={CPF_FORMATTED_MAX_LENGTH}
              onInput={(event) => {
                event.currentTarget.value = formatCpf(event.currentTarget.value);
                event.currentTarget.setCustomValidity("");
              }}
              required
            />
            <Field label="Data de nascimento" name="birthDate" type="date" required />
            <Field
              label="Telefone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={PHONE_FORMATTED_MAX_LENGTH}
              onInput={(event) => {
                event.currentTarget.value = formatBrazilianPhone(event.currentTarget.value);
                event.currentTarget.setCustomValidity("");
              }}
              required
            />
          </StepForm>
        )}
        {step === 2 && (
          <StepForm onSubmit={submitForm}>
            <Field label="Cidade" name="city" autoComplete="address-level2" required />
            <Field label="Estado" name="regionCode" maxLength={2} required />
            <label className="field">
              <span>Experiência comercial</span>
              <textarea name="experience" maxLength={500} rows={4} required />
            </label>
            <Field label="Canal principal de atuação" name="salesChannel" required />
          </StepForm>
        )}
        {step === 3 && (
          <StepForm onSubmit={submitForm}>
            <Field label="Código de indicação (opcional)" name="referralCode" />
            <p className="field-help">
              O vínculo é validado no servidor e não pode criar ciclos ou autorreferência.
            </p>
          </StepForm>
        )}
        {step === 4 && (
          <div className="form-stack">
            <form className="document-upload-form" onSubmit={(event) => void uploadDocument(event)}>
              <label className="field">
                <span>Tipo de documento</span>
                <select name="documentType" required>
                  <option value="identity_front">Documento com foto</option>
                  <option value="address_proof">Comprovante de endereço</option>
                  <option value="commercial_support">Comprovação comercial</option>
                </select>
              </label>
              <label className="file-drop">
                <input
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  required
                />
                <FileCheck2 />
                <span>PDF, JPG, PNG ou WebP · até 10 MB</span>
              </label>
              <button className="secondary-button" disabled={saving}>
                {saving ? <LoaderCircle className="spin" /> : <Save />} Enviar documento
              </button>
            </form>
            {documents.map((document) => (
              <p className="uploaded-document" key={document}>
                <Check /> {document}
              </p>
            ))}
            <button
              className="primary-button"
              type="button"
              onClick={() => void save({ documentsConfirmed: true })}
            >
              Continuar
            </button>
          </div>
        )}
        {step === 5 && (
          <StepForm onSubmit={submitForm}>
            <div className="terms-box">
              <h2>Termos do programa</h2>
              <p>
                Leia os termos vigentes antes de aceitar. A versão e o horário do aceite serão
                registrados.
              </p>
              <a href="/termos-de-uso" target="_blank">
                Ler termos completos
              </a>
            </div>
            <label className="check-row">
              <input name="termsAccepted" type="checkbox" required />
              <span>Li e aceito os termos vigentes do programa de representantes.</span>
            </label>
          </StepForm>
        )}
        {step === 6 && (
          <div className="review-application">
            <div>
              <Check />
              <span>Dados pessoais preenchidos</span>
            </div>
            <div>
              <Check />
              <span>Perfil comercial informado</span>
            </div>
            <div>
              <Check />
              <span>Termos registrados</span>
            </div>
            <p>
              Ao enviar, a solicitação ficará bloqueada para edição até uma eventual solicitação de
              correção.
            </p>
            <button
              className="primary-button full-button"
              type="button"
              onClick={() => void submitApplication()}
              disabled={saving}
            >
              {saving ? <LoaderCircle className="spin" /> : <FileCheck2 />} Enviar para análise
            </button>
          </div>
        )}
        {message && (
          <p className="form-message" role="status" aria-live="polite">
            {message}
          </p>
        )}
        <footer className="wizard-footer">
          <button
            className="text-button"
            type="button"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={step === 1 || saving}
          >
            <ArrowLeft /> Voltar
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => void save({}, false)}
            disabled={saving}
          >
            <Save /> Salvar rascunho
          </button>
        </footer>
      </section>
    </div>
  );
}

function StepForm({
  children,
  onSubmit
}: {
  children: React.ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="form-stack representative-step-form" onSubmit={onSubmit}>
      {children}
      <button className="primary-button" type="submit">
        Salvar e continuar <ArrowRight />
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} {...props} />
    </label>
  );
}

const statusLabel = (status: string) =>
  ({
    submitted: "enviada",
    under_review: "em análise",
    approved: "aprovada",
    rejected: "encerrada",
    suspended: "suspensa",
    cancelled: "cancelada"
  })[status] ?? status;
