import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnauthorizedOptionalData,
  consentState,
  consentStorageKey,
  hasConsentCategory,
  readValidConsent,
  setCurrentCookiePolicyVersion,
  writeStoredConsent
} from "./consent-client";
import { consentMaxAgeMs, cookiePolicyVersion } from "./cookie-inventory";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const current = cookiePolicyVersion(null);
const consent = (overrides: Partial<{ policyVersion: string; recordedAt: string; analytics: boolean }> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  policyVersion: overrides.policyVersion ?? current,
  categories: { essential: true, preferences: true, analytics: overrides.analytics ?? true },
  recordedAt: overrides.recordedAt ?? new Date().toISOString()
});

describe("consentimento no navegador", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    setCurrentCookiePolicyVersion(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("primeira visita: nada autorizado", () => {
    expect(consentState()).toBe("missing");
    expect(hasConsentCategory("analytics")).toBe(false);
    expect(hasConsentCategory("preferences")).toBe(false);
  });

  it("escolha vigente persiste após recarregar", () => {
    writeStoredConsent(consent());
    expect(consentState()).toBe("valid");
    expect(hasConsentCategory("analytics")).toBe(true);
  });

  it("escolha com mais de 12 meses expira e deixa de autorizar", () => {
    writeStoredConsent(consent({ recordedAt: new Date(Date.now() - consentMaxAgeMs - 60_000).toISOString() }));
    expect(consentState()).toBe("expired");
    expect(hasConsentCategory("analytics")).toBe(false);
  });

  it("data inválida ou futura não vale como escolha", () => {
    writeStoredConsent(consent({ recordedAt: "manipulado" }));
    expect(consentState()).toBe("expired");
    writeStoredConsent(consent({ recordedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }));
    expect(consentState()).toBe("expired");
  });

  it("alteração da política exige nova escolha", () => {
    writeStoredConsent(consent());
    setCurrentCookiePolicyVersion(cookiePolicyVersion(2));
    expect(consentState()).toBe("outdated");
    expect(readValidConsent()).toBeNull();
    writeStoredConsent(consent({ policyVersion: "cookies-draft-inventory-2" }));
    setCurrentCookiePolicyVersion(null);
    expect(consentState()).toBe("outdated");
  });

  it("registro editado ou corrompido no navegador vale como ausente", () => {
    localStorage.setItem(consentStorageKey, "{nope");
    expect(consentState()).toBe("missing");
    localStorage.setItem(consentStorageKey, JSON.stringify({ id: 1, categories: { analytics: true } }));
    expect(hasConsentCategory("analytics")).toBe(false);
    localStorage.setItem(consentStorageKey, JSON.stringify({ ...consent(), categories: { analytics: "true" } }));
    expect(hasConsentCategory("analytics")).toBe(false);
  });

  it("recusa ou retirada apaga os dados opcionais e preserva os essenciais", () => {
    localStorage.setItem("curtiz-recent-searches", "[\"chinelo\"]");
    localStorage.setItem("curtiz:intelligence-recent", "[]");
    localStorage.setItem("curtiz-cart", "[]");
    localStorage.setItem("curtiz-favorites", "[]");
    clearUnauthorizedOptionalData({ essential: true, preferences: true, analytics: false });
    expect(localStorage.getItem("curtiz-recent-searches")).not.toBeNull();
    expect(localStorage.getItem("curtiz:intelligence-recent")).toBeNull();
    clearUnauthorizedOptionalData({ essential: true });
    expect(localStorage.getItem("curtiz-recent-searches")).toBeNull();
    expect(localStorage.getItem("curtiz-cart")).toBe("[]");
    expect(localStorage.getItem("curtiz-favorites")).toBe("[]");
  });
});
