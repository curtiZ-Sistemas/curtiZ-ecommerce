"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cookie, LoaderCircle, Settings2, X } from "lucide-react";
import {
  defaultCookieInventory,
  type CookieCategory,
  type CookieInventory,
  type CookieInventoryItem,
  type StorageType
} from "../lib/privacy/cookie-inventory";
import { consentStorageKey, readStoredConsent } from "../lib/privacy/consent-client";

const storageTypeLabels: Record<StorageType, string> = {
  cookie: "Cookie",
  local_storage: "Armazenamento local",
  session_storage: "Armazenamento da sessão"
};

function validCategory(value: unknown): CookieCategory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.label !== "string" ||
    typeof entry.description !== "string"
  )
    return null;
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    required: entry.required === true
  };
}

function validCookie(value: unknown): CookieInventoryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.name_pattern !== "string" ||
    typeof entry.category_id !== "string" ||
    typeof entry.provider !== "string" ||
    typeof entry.purpose !== "string" ||
    typeof entry.duration_description !== "string"
  )
    return null;
  const storageType = ["cookie", "local_storage", "session_storage"].includes(
    String(entry.storage_type)
  )
    ? (entry.storage_type as StorageType)
    : "cookie";
  return {
    name_pattern: entry.name_pattern,
    category_id: entry.category_id,
    provider: entry.provider,
    purpose: entry.purpose,
    duration_description: entry.duration_description,
    first_party: entry.first_party !== false,
    storage_type: storageType
  };
}

function validInventory(value: unknown): CookieInventory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const categories = Array.isArray(data.categories)
    ? data.categories.map(validCategory).filter((item): item is CookieCategory => Boolean(item))
    : [];
  const cookies = Array.isArray(data.cookies)
    ? data.cookies.map(validCookie).filter((item): item is CookieInventoryItem => Boolean(item))
    : [];
  if (!categories.length || !cookies.length) return null;
  return {
    categories,
    cookies,
    policyVersion:
      typeof data.policyVersion === "string"
        ? data.policyVersion
        : defaultCookieInventory().policyVersion
  };
}

function choicesFor(inventory: CookieInventory, stored: ReturnType<typeof readStoredConsent>) {
  return Object.fromEntries(
    inventory.categories.map((category) => [
      category.id,
      category.required || stored?.categories[category.id] === true
    ])
  );
}

export function CookiePreferences() {
  const [inventory, setInventory] = useState<CookieInventory>(() => defaultCookieInventory());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, boolean>>({ essential: true });

  const useInventory = useCallback((nextInventory: CookieInventory) => {
    const stored = readStoredConsent();
    setInventory(nextInventory);
    setChoices(choicesFor(nextInventory, stored));
    setOpen(!stored || stored.policyVersion !== nextInventory.policyVersion);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/privacy/cookies", { cache: "no-store" });
      if (!response.ok) throw new Error("inventory_unavailable");
      useInventory(validInventory(await response.json()) ?? defaultCookieInventory());
    } catch {
      useInventory(defaultCookieInventory());
    } finally {
      setReady(true);
    }
  }, [useInventory]);

  useEffect(() => {
    void load();
    const reopen = () => {
      setOpen(true);
      setCustomizing(true);
    };
    window.addEventListener("open-cookie-preferences", reopen);
    return () => window.removeEventListener("open-cookie-preferences", reopen);
  }, [load]);

  const optional = useMemo(
    () =>
      inventory.categories.filter(
        (category) =>
          !category.required &&
          inventory.cookies.some((cookie) => cookie.category_id === category.id)
      ),
    [inventory]
  );
  const visibleCategories = useMemo(
    () => inventory.categories.filter((category) => category.required || optional.includes(category)),
    [inventory.categories, optional]
  );
  const hasOptional = optional.length > 0;

  const save = async (
    next: Record<string, boolean>,
    origin: "banner" | "preferences",
    revoked = false
  ) => {
    setPending(true);
    setError("");
    const stored = readStoredConsent();
    const id = stored?.id ?? crypto.randomUUID();
    const normalized = Object.fromEntries(
      visibleCategories.map((category) => [
        category.id,
        category.required || next[category.id] === true
      ])
    );
    try {
      const response = await fetch("/api/privacy/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          policyVersion: inventory.policyVersion,
          categories: normalized,
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
      const rejectsOptional = optional.every((category) => normalized[category.id] !== true);
      if (!response.ok || (!persisted && !rejectsOptional)) {
        const message =
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          typeof (result as Record<string, unknown>).message === "string"
            ? (result as Record<string, string>).message
            : "Não foi possível salvar.";
        throw new Error(message);
      }
      localStorage.setItem(
        consentStorageKey,
        JSON.stringify({
          id,
          policyVersion: inventory.policyVersion,
          categories: normalized,
          recordedAt: new Date().toISOString()
        })
      );
      if (normalized.preferences !== true) localStorage.removeItem("curtiz-recent-searches");
      window.dispatchEvent(new Event("curtiz-consent-changed"));
      setChoices(normalized);
      setOpen(false);
      setCustomizing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setPending(false);
    }
  };

  if (!ready || !open) return null;

  const rejectedChoices = Object.fromEntries(
    visibleCategories.map((category) => [category.id, category.required])
  );
  const acceptedChoices = Object.fromEntries(
    visibleCategories.map((category) => [category.id, true])
  );
  const showInventory = customizing || !hasOptional;

  return (
    <div className="cookie-consent-layer" role="region" aria-label="Preferências de cookies">
      <section className={customizing ? "cookie-consent-card customizing" : "cookie-consent-card"}>
        <div className="cookie-consent-heading">
          <Cookie aria-hidden="true" />
          <div>
            <h2>Cookies e privacidade</h2>
            <p>
              {hasOptional
                ? "Usamos recursos essenciais. Preferências e medição só são ativadas com sua escolha."
                : "No momento, usamos apenas recursos essenciais para segurança e funcionamento da loja."}
            </p>
          </div>
          {customizing && (
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar preferências"
              onClick={() => setCustomizing(false)}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>

        {showInventory && (
          <div className="cookie-category-list">
            {visibleCategories.map((category) => (
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
            <details>
              <summary>Ver inventário verificado</summary>
              {inventory.cookies
                .filter((cookie) =>
                  visibleCategories.some((category) => category.id === cookie.category_id)
                )
                .map((cookie) => (
                  <p key={`${cookie.provider}-${cookie.name_pattern}-${cookie.storage_type}`}>
                    <code>{cookie.name_pattern}</code> · {cookie.provider}
                    <br />
                    <small>
                      {storageTypeLabels[cookie.storage_type]} {cookie.first_party ? "próprio" : "de terceiro"}. {cookie.purpose} Duração: {cookie.duration_description}
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
          {hasOptional ? (
            <>
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => void save(rejectedChoices, "banner", true)}
              >
                Rejeitar opcionais
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => setCustomizing(true)}
              >
                <Settings2 aria-hidden="true" />
                Personalizar
              </button>
              {customizing ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void save(choices, "preferences")}
                >
                  {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                  Salvar preferências
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void save(acceptedChoices, "banner")}
                >
                  {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                  Aceitar opcionais
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={pending}
              onClick={() => void save(rejectedChoices, "banner")}
            >
              {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
              Entendi
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
