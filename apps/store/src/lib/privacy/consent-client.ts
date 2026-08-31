"use client";

export const consentStorageKey = "curtiz-cookie-consent";

export type StoredConsent = {
  id: string;
  policyVersion: string;
  categories: Record<string, boolean>;
  recordedAt: string;
};

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
    const categories = record.categories as Record<string, boolean>;
    return {
      id: record.id,
      policyVersion: record.policyVersion,
      categories: {
        ...categories,
        preferences: categories.preferences === true || categories.functional === true,
        essential: true
      },
      recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : ""
    };
  } catch {
    return null;
  }
}

export function hasConsentCategory(category: "preferences" | "analytics" | "marketing") {
  return readStoredConsent()?.categories[category] === true;
}
