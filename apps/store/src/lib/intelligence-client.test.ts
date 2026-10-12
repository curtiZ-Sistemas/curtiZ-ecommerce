import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyIntelligenceConsent,
  flushIntelligence,
  intelligenceSessionId,
  recentlyViewedProductIds,
  rememberViewedProduct,
  startIntelligence,
  suspendIntelligence,
  trackIntelligence
} from "./intelligence-client";
import { consentStorageKey, setCurrentCookiePolicyVersion } from "./privacy/consent-client";
import { cookiePolicyVersion } from "./privacy/cookie-inventory";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const productId = "33333333-3333-4333-8333-333333333333";
const setConsent = (analytics: boolean) => localStorage.setItem(consentStorageKey, JSON.stringify({
  id: "11111111-1111-4111-8111-111111111111",
  policyVersion: cookiePolicyVersion(null),
  categories: { essential: true, preferences: false, analytics },
  recordedAt: new Date().toISOString()
}));
type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;
const callsWith = (fetchMock: FetchMock, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === method);
const posts = (fetchMock: FetchMock) => callsWith(fetchMock, "POST");
const jsonBody = (init: RequestInit | undefined): unknown =>
  typeof init?.body === "string" ? JSON.parse(init.body) : null;

describe("Intelligence Engine no navegador", () => {
  let fetchMock: FetchMock;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      innerWidth: 390, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout
    }));
    vi.stubGlobal("location", { pathname: "/produtos" });
    vi.stubGlobal("navigator", {});
    fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    setCurrentCookiePolicyVersion(null);
    suspendIntelligence();
  });
  afterEach(() => {
    suspendIntelligence();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("não cria identificador, não guarda produtos e não envia nada antes da autorização", async () => {
    startIntelligence();
    trackIntelligence({ type: "product_view", productId });
    rememberViewedProduct(productId);
    await flushIntelligence();
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(intelligenceSessionId()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("curtiz:intelligence-recent")).toBeNull();
  });

  it("coleta somente depois do aceite e sem repetir a visualização ao salvar de novo", async () => {
    startIntelligence();
    setConsent(true);
    applyIntelligenceConsent();
    applyIntelligenceConsent();
    rememberViewedProduct(productId);
    await flushIntelligence();
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    const body = jsonBody(sent[0]?.[1]) as { events: Array<{ type: string }> };
    expect(body.events.map((event) => event.type)).toEqual(["page_view"]);
    expect(recentlyViewedProductIds()).toEqual([productId]);
  });

  it("retirada durante a sessão cancela o envio em andamento, descarta a fila e apaga os dados locais", async () => {
    setConsent(true);
    startIntelligence();
    let aborted = false;
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method !== "POST") return Promise.resolve(new Response("{}"));
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }));
    });
    rememberViewedProduct(productId);
    const sessionId = intelligenceSessionId();
    const pending = flushIntelligence();
    trackIntelligence({ type: "cart_add", productId });
    setConsent(false);
    applyIntelligenceConsent();
    await pending;
    await vi.runAllTimersAsync();
    expect(aborted).toBe(true);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(jsonBody(callsWith(fetchMock, "DELETE")[0]?.[1])).toEqual({ sessionId });
    expect(sessionStorage.getItem("curtiz:intelligence-session")).toBeNull();
    expect(localStorage.getItem("curtiz:intelligence-recent")).toBeNull();
  });

  it("falha de rede só reenvia enquanto a autorização continua válida", async () => {
    setConsent(true);
    startIntelligence();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await flushIntelligence();
    setConsent(false);
    await vi.runAllTimersAsync();
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it("consentimento expirado interrompe a coleta", async () => {
    localStorage.setItem(consentStorageKey, JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      policyVersion: cookiePolicyVersion(null),
      categories: { essential: true, analytics: true },
      recordedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    }));
    startIntelligence();
    await flushIntelligence();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
