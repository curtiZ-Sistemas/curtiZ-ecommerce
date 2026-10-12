"use client";

import { consentMaxAgeMs, isCurrentInventoryVersion } from "./cookie-inventory";

export const consentStorageKey = "curtiz-cookie-consent";
export const consentChangedEvent = "curtiz-consent-changed";

export type StoredConsent = {
  id: string;
  policyVersion: string;
  categories: Record<string, boolean>;
  recordedAt: string;
};

// Dados opcionais que deixam de existir quando a categoria correspondente é recusada ou retirada.
// A sessão do Intelligence Engine é apagada pelo próprio cliente, que antes pede a exclusão remota.
const optionalLocalData = {
  preferences: ["curtiz-recent-searches"],
  analytics: ["curtiz:intelligence-recent"]
} as const;

let currentPolicyVersion: string | null = null;

/** Versão vigente informada pelo inventário; escolhas de outra versão deixam de valer. */
export function setCurrentCookiePolicyVersion(policyVersion: string | null) {
  currentPolicyVersion = policyVersion;
}

export function readStoredConsent(): StoredConsent | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(consentStorageKey) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.policyVersion !== "string" ||
      !record.categories ||
      typeof record.categories !== "object" ||
      Array.isArray(record.categories)
    )
      return null;
    const categories = record.categories as Record<string, unknown>;
    return {
      id: record.id,
      policyVersion: record.policyVersion,
      categories: {
        preferences: categories.preferences === true || categories.functional === true,
        analytics: categories.analytics === true,
        marketing: categories.marketing === true,
        essential: true
      },
      recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : ""
    };
  } catch {
    return null;
  }
}

export type ConsentState = "missing" | "valid" | "expired" | "outdated";

export function consentState(stored = readStoredConsent(), now = Date.now()): ConsentState {
  if (!stored) return "missing";
  const recordedAt = Date.parse(stored.recordedAt);
  if (!Number.isFinite(recordedAt) || recordedAt > now + 5 * 60 * 1000 || now - recordedAt > consentMaxAgeMs)
    return "expired";
  if (!isCurrentInventoryVersion(stored.policyVersion)
    || (currentPolicyVersion !== null && stored.policyVersion !== currentPolicyVersion))
    return "outdated";
  return "valid";
}

/** Escolha que pode ser aplicada agora: expirada ou de política anterior vale como ausente. */
export function readValidConsent(): StoredConsent | null {
  const stored = readStoredConsent();
  return consentState(stored) === "valid" ? stored : null;
}

export function hasConsentCategory(category: "preferences" | "analytics" | "marketing") {
  return readValidConsent()?.categories[category] === true;
}

export function writeStoredConsent(consent: StoredConsent) {
  localStorage.setItem(consentStorageKey, JSON.stringify(consent));
}

/** Remove do navegador os dados das categorias que não estão autorizadas. */
export function clearUnauthorizedOptionalData(categories: Record<string, boolean>) {
  try {
    for (const [category, keys] of Object.entries(optionalLocalData)) {
      if (categories[category] !== true) for (const key of keys) localStorage.removeItem(key);
    }
  } catch {
    // Armazenamento bloqueado: não há dados opcionais a remover.
  }
}

export function notifyConsentChanged() {
  window.dispatchEvent(new Event(consentChangedEvent));
}
