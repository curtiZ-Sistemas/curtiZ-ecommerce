"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cookie, LoaderCircle, Settings2, X } from "lucide-react";

type Category = { id: string; label: string; description: string; required: boolean };
type InventoryCookie = {
  name_pattern: string;
  category_id: string;
  provider: string;
  purpose: string;
  duration_description: string;
};
type Inventory = { categories: Category[]; cookies: InventoryCookie[]; policyVersion: string };
const storageKey = "curtiz-cookie-consent";

function validInventory(value: unknown): Inventory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const categories = Array.isArray(data.categories)
    ? data.categories
        .flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? [entry as Record<string, unknown>]
            : []
        )
        .flatMap((entry) =>
          typeof entry.id === "string" &&
          typeof entry.label === "string" &&
          typeof entry.description === "string"
            ? [
                {
                  id: entry.id,
                  label: entry.label,
                  description: entry.description,
                  required: entry.required === true
                }
              ]
            : []
        )
    : [];
  const cookies = Array.isArray(data.cookies)
    ? data.cookies
        .flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? [entry as Record<string, unknown>]
            : []
        )
        .flatMap((entry) =>
          typeof entry.name_pattern === "string" &&
          typeof entry.category_id === "string" &&
          typeof entry.provider === "string" &&
          typeof entry.purpose === "string" &&
          typeof entry.duration_description === "string"
            ? [
                {
                  name_pattern: entry.name_pattern,
                  category_id: entry.category_id,
                  provider: entry.provider,
                  purpose: entry.purpose,
                  duration_description: entry.duration_description
                }
              ]
            : []
        )
    : [];
  return {
    categories,
    cookies,
    policyVersion: typeof data.policyVersion === "string" ? data.policyVersion : "inventory-1"
  };
}

export function CookiePreferences() {
  const [inventory, setInventory] = useState<Inventory>({
    categories: [],
    cookies: [],
    policyVersion: "inventory-1"
  });
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, boolean>>({ essential: true });
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/privacy/cookies", { cache: "no-store" });
      const data = validInventory(await response.json());
      if (data) {
        setInventory(data);
        setChoices((current) =>
          Object.fromEntries(
            data.categories.map((category) => [
              category.id,
              category.required || current[category.id] === true
            ])
          )
        );
      }
    } catch {
      /* O banner continua funcional apenas com a categoria essencial. */
    }
  }, []);
  useEffect(() => {
    void load();
    const saved = localStorage.getItem(storageKey);
    setOpen(!saved);
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const stored = (parsed as Record<string, unknown>).categories;
          if (stored && typeof stored === "object" && !Array.isArray(stored))
            setChoices({ essential: true, ...(stored as Record<string, boolean>) });
        }
      } catch {
        setOpen(true);
      }
    }
    const reopen = () => {
      setOpen(true);
      setCustomizing(true);
    };
    window.addEventListener("open-cookie-preferences", reopen);
    return () => window.removeEventListener("open-cookie-preferences", reopen);
  }, [load]);
  const optional = useMemo(
    () => inventory.categories.filter((category) => !category.required),
    [inventory]
  );
  const save = async (
    next: Record<string, boolean>,
    origin: "banner" | "preferences",
    revoked = false
  ) => {
    setPending(true);
    setError("");
    const id = (() => {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed: unknown = JSON.parse(saved);
          if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            typeof (parsed as Record<string, unknown>).id === "string"
          )
            return (parsed as Record<string, string>).id;
        } catch {
          /* gera novo identificador anônimo */
        }
      }
      return crypto.randomUUID();
    })();
    try {
      const response = await fetch("/api/privacy/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          policyVersion: inventory.policyVersion,
          categories: { ...next, essential: true },
          origin,
          revoked
        })
      });
      const result: unknown = await response.json();
      const persisted =
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (result as Record<string, unknown>).persisted === true;
      const rejectsOptional = !Object.entries(next).some(
        ([key, enabled]) => key !== "essential" && enabled
      );
      if (!response.ok || (!persisted && !rejectsOptional))
        throw new Error(
          result &&
            typeof result === "object" &&
            !Array.isArray(result) &&
            typeof (result as Record<string, unknown>).message === "string"
            ? (result as Record<string, string>).message
            : "Não foi possível salvar."
        );
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          id,
          policyVersion: inventory.policyVersion,
          categories: { ...next, essential: true },
          recordedAt: new Date().toISOString()
        })
      );
      window.dispatchEvent(new Event("curtiz-consent-changed"));
      setChoices({ ...next, essential: true });
      setOpen(false);
      setCustomizing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setPending(false);
    }
  };
  if (!open) return null;
  return (
    <div className="cookie-consent-layer" role="region" aria-label="Preferências de cookies">
      <section className={customizing ? "cookie-consent-card customizing" : "cookie-consent-card"}>
        <div className="cookie-consent-heading">
          <Cookie aria-hidden="true" />
          <div>
            <h2>Cookies e privacidade</h2>
            <p>
              Usamos cookies essenciais para segurança. Os opcionais só serão ativados com sua
              escolha.
            </p>
          </div>
          {customizing && (
            <button
              className="icon-button"
              aria-label="Fechar preferências"
              onClick={() => setCustomizing(false)}
            >
              <X />
            </button>
          )}
        </div>
        {customizing && (
          <div className="cookie-category-list">
            {inventory.categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={category.required || choices[category.id] === true}
                  disabled={category.required}
                  onChange={(event) =>
                    setChoices((current) => ({ ...current, [category.id]: event.target.checked }))
                  }
                />
                <span>
                  <strong>
                    {category.label}
                    {category.required ? " · sempre ativo" : ""}
                  </strong>
                  <small>{category.description}</small>
                </span>
              </label>
            ))}
            {optional.length === 0 && <p>Nenhum cookie opcional está ativo no inventário atual.</p>}
            <details>
              <summary>Ver inventário verificado</summary>
              {inventory.cookies.map((cookie) => (
                <p key={`${cookie.provider}-${cookie.name_pattern}`}>
                  <code>{cookie.name_pattern}</code> · {cookie.provider}
                  <br />
                  <small>
                    {cookie.purpose} Duração: {cookie.duration_description}
                  </small>
                </p>
              ))}
            </details>
          </div>
        )}
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        <div className="cookie-consent-actions">
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() =>
              void save(
                Object.fromEntries(
                  inventory.categories.map((category) => [category.id, category.required])
                ),
                "banner",
                true
              )
            }
          >
            Rejeitar opcionais
          </button>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => setCustomizing(true)}
          >
            <Settings2 />
            Personalizar
          </button>
          {customizing ? (
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => void save(choices, "preferences")}
            >
              {pending ? <LoaderCircle className="spin" /> : null}Salvar preferências
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={pending}
              onClick={() =>
                void save(
                  Object.fromEntries(inventory.categories.map((category) => [category.id, true])),
                  "banner"
                )
              }
            >
              {pending ? <LoaderCircle className="spin" /> : null}Aceitar todos
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      className="footer-cookie-button"
      onClick={() => window.dispatchEvent(new Event("open-cookie-preferences"))}
    >
      Preferências de cookies
    </button>
  );
}
