"use client";

import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  UserRound,
  X
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useRef, useState } from "react";
import {
  assessPassword,
  normalizeEmail,
  normalizeFullName,
  parseSignupInput
} from "@/lib/signup-validation";
import { TurnstileField } from "./turnstile-field";

type SignupResult = {
  code?: string;
  message: string;
  redirectTo?: string;
  issues?: Record<string, string[] | undefined>;
};

type SignupFields = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

type SignupErrorKey = keyof SignupFields | "terms" | "form";

const initialFields: SignupFields = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: ""
};

export function SignupForm({
  returnTo,
  turnstileEnabled = false
}: {
  returnTo?: string;
  turnstileEnabled?: boolean;
}) {
  const [fields, setFields] = useState(initialFields);
  const [errors, setErrors] = useState<Partial<Record<SignupErrorKey, string>>>({});
  const [message, setMessage] = useState("");
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const submitLock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const passwordAssessment = useMemo(
    () =>
      assessPassword(fields.password, {
        name: fields.name,
        email: fields.email,
        phone: fields.phone
      }),
    [fields.email, fields.name, fields.password, fields.phone]
  );

  const updateField = (field: keyof SignupFields, value: string) => {
    const nextValue =
      field === "name"
        ? normalizeFullName(value)
        : field === "email"
          ? normalizeEmail(value)
          : value;
    setFields((current) => ({ ...current, [field]: nextValue }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const focusFirstInvalid = (fieldErrors: typeof errors) => {
    const order: SignupErrorKey[] = [
      "name",
      "email",
      "phone",
      "password",
      "confirmPassword",
      "terms"
    ];
    const first = order.find((field) => fieldErrors[field]);
    if (first && first !== "form") {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current) return;

    const form = new FormData(event.currentTarget);
    const payload = {
      ...Object.fromEntries(form),
      ...fields,
      ...(returnTo ? { next: returnTo } : {}),
      ...(turnstileEnabled ? { turnstileToken } : {})
    };
    const validation = parseSignupInput(payload);
    if (!validation.success) {
      const flattened = validation.error.flatten().fieldErrors as Record<
        string,
        string[] | undefined
      >;
      const nextErrors = Object.fromEntries(
        Object.entries(flattened).map(([field, messages]) => [field, messages?.[0]])
      ) as typeof errors;
      setErrors(nextErrors);
      focusFirstInvalid(nextErrors);
      return;
    }

    submitLock.current = true;
    setIsSubmitting(true);
    setMessage("");
    setErrors({});

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validation.data)
      });
      const result = (await response.json()) as SignupResult;
      setMessage(result.message);

      if (response.ok && result.code === "email_confirmation_required") {
        setConfirmationRequired(true);
        setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
        return;
      }
      if (response.ok && result.redirectTo) {
        window.location.assign(result.redirectTo);
        return;
      }

      const serverErrors = Object.fromEntries(
        Object.entries(result.issues ?? {}).map(([field, messages]) => [field, messages?.[0]])
      ) as typeof errors;
      if (Object.keys(serverErrors).length) {
        setErrors(serverErrors);
        focusFirstInvalid(serverErrors);
      } else {
        setErrors({ form: result.message });
      }
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
    } catch {
      const errorMessage = "Não foi possível criar sua conta agora. Tente novamente.";
      setMessage(errorMessage);
      setErrors({ form: errorMessage });
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  const resendConfirmation = async () => {
    if (isResending) return;
    setIsResending(true);
    try {
      const response = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: normalizeEmail(fields.email),
          ...(returnTo ? { next: returnTo } : {})
        })
      });
      const result = (await response.json()) as SignupResult;
      setMessage(result.message);
    } catch {
      setMessage("Não foi possível reenviar agora. Aguarde e tente novamente.");
    } finally {
      setIsResending(false);
    }
  };

  if (confirmationRequired) {
    return (
      <section className="signup-confirmation" aria-labelledby="confirmation-title">
        <span className="signup-confirmation-icon"><Mail aria-hidden="true" /></span>
        <h2 id="confirmation-title">Confirme seu e-mail</h2>
        <p>
          Enviamos as instruções para <strong>{fields.email}</strong>. Depois da confirmação,
          você seguirá automaticamente para {returnTo === "/checkout" ? "o checkout" : "seu perfil"}.
        </p>
        {message && <p className="form-message success" role="status">{message}</p>}
        <button
          className="secondary-button full-button"
          type="button"
          onClick={() => void resendConfirmation()}
          disabled={isResending}
        >
          {isResending && <LoaderCircle className="spin" aria-hidden="true" />}
          {isResending ? "Reenviando…" : "Reenviar e-mail"}
        </button>
        <Link className="text-link" href={`/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}>
          Voltar para o login
        </Link>
      </section>
    );
  }

  const passwordRequirements = [
    ["minimumLength", "Mínimo de 6 caracteres"],
    ["hasLetter", "Pelo menos uma letra"],
    ["hasNumber", "Pelo menos um número"],
    ["noObviousSequence", "Sem sequência ou senha comum"],
    ["differsFromPersonalData", "Diferente dos seus dados pessoais"]
  ] as const;

  return (
    <form
      ref={formRef}
      className="form-stack auth-form signup-form"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className="field">
        <label htmlFor="signup-name">Nome completo</label>
        <div className={errors.name ? "input-shell invalid" : "input-shell"}>
          <UserRound aria-hidden="true" />
          <input
            id="signup-name"
            name="name"
            autoComplete="name"
            value={fields.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Nome e sobrenome"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "signup-name-error" : undefined}
            required
          />
        </div>
        {errors.name && <p id="signup-name-error" className="field-error">{errors.name}</p>}
      </div>

      <div className="field">
        <label htmlFor="signup-email">E-mail</label>
        <div className={errors.email ? "input-shell invalid" : "input-shell"}>
          <Mail aria-hidden="true" />
          <input
            id="signup-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={fields.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="voce@exemplo.com.br"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "signup-email-error" : undefined}
            required
          />
        </div>
        {errors.email && <p id="signup-email-error" className="field-error">{errors.email}</p>}
      </div>

      <div className="field">
        <label htmlFor="signup-phone">Telefone</label>
        <div className={errors.phone ? "input-shell invalid" : "input-shell"}>
          <Phone aria-hidden="true" />
          <input
            id="signup-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={fields.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="(31) 99999-0000"
            maxLength={24}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "signup-phone-error" : "signup-phone-help"}
            required
          />
        </div>
        {errors.phone ? (
          <p id="signup-phone-error" className="field-error">{errors.phone}</p>
        ) : (
          <p id="signup-phone-help" className="field-help">Informe DDD e 10 ou 11 dígitos.</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="signup-password">Senha</label>
        <div className={errors.password ? "input-shell invalid" : "input-shell"}>
          <LockKeyhole aria-hidden="true" />
          <input
            id="signup-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={fields.password}
            onChange={(event) => updateField("password", event.target.value)}
            placeholder="Crie uma senha segura"
            aria-invalid={Boolean(errors.password)}
            aria-describedby="signup-password-requirements"
            required
          />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <div
          className={`password-strength strength-${passwordAssessment.score}`}
          aria-label={`Força da senha: ${passwordAssessment.score} de 5`}
        >
          <span style={{ width: `${passwordAssessment.score * 20}%` }} />
        </div>
        <ul id="signup-password-requirements" className="password-requirements">
          {passwordRequirements.map(([key, label]) => {
            const met = passwordAssessment[key];
            return (
              <li className={met ? "met" : ""} key={key}>
                {met ? <Check aria-hidden="true" /> : <X aria-hidden="true" />} {label}
              </li>
            );
          })}
        </ul>
        {errors.password && <p className="field-error">{errors.password}</p>}
      </div>

      <div className="field">
        <label htmlFor="signup-confirm">Confirmar senha</label>
        <div className={errors.confirmPassword ? "input-shell invalid" : "input-shell"}>
          <Check aria-hidden="true" />
          <input
            id="signup-confirm"
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={fields.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
            placeholder="Repita a senha"
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? "signup-confirm-error" : undefined}
            required
          />
        </div>
        {errors.confirmPassword && (
          <p id="signup-confirm-error" className="field-error">{errors.confirmPassword}</p>
        )}
      </div>

      <label className="check-row">
        <input
          name="terms"
          type="checkbox"
          required
          aria-invalid={Boolean(errors.terms)}
          aria-describedby={errors.terms ? "signup-terms-error" : undefined}
          onChange={() => setErrors((current) => ({ ...current, terms: undefined }))}
        />
        <span>
          Li e aceito os <Link href="/termos-de-uso">Termos de Uso</Link> e a{" "}
          <Link href="/politica-de-privacidade">Política de Privacidade</Link>.
        </span>
      </label>
      {errors.terms && (
        <p id="signup-terms-error" className="field-error">
          Aceite os termos e a política de privacidade para continuar.
        </p>
      )}
      <label className="check-row">
        <input name="marketing" type="checkbox" />
        <span>Quero receber novidades e ofertas da curti Z.</span>
      </label>

      {errors.form && <p className="form-message error" role="alert">{errors.form}</p>}
      {message && !errors.form && <p className="form-message" role="status">{message}</p>}

      <TurnstileField enabled={turnstileEnabled} onToken={setTurnstileToken} />

      <button
        className="primary-button full-button auth-submit"
        type="submit"
        disabled={isSubmitting || (turnstileEnabled && !turnstileToken)}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? (
          <><LoaderCircle className="spin" aria-hidden="true" /> Criando sua conta…</>
        ) : (
          <>Criar minha conta <ArrowRight aria-hidden="true" /></>
        )}
      </button>
    </form>
  );
}
