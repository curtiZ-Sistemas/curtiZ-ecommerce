"use client";

import { hasConsentCategory } from "./privacy/consent-client";

export type IntelligenceEventType =
  | "page_view"
  | "product_impression"
  | "product_view"
  | "image_interaction"
  | "variant_select"
  | "category_view"
  | "search"
  | "search_no_results"
  | "search_result_click"
  | "recommendation_impression"
  | "recommendation_click"
  | "favorite_add"
  | "favorite_remove"
  | "cart_add"
  | "cart_remove"
  | "checkout_start";

export type IntelligenceEvent = {
  type: IntelligenceEventType;
  productId?: string;
  variantId?: string;
  query?: string;
  resultCount?: number;
  source?: string;
  path?: string;
};

const sessionKey = "curtiz:intelligence-session";
const recentKey = "curtiz:intelligence-recent";
const maxBatch = 20;
let queue: Array<IntelligenceEvent & { id: string; occurredAt: string; device: string }> = [];
let timer: number | undefined;
let flushing = false;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function hasAnalyticsConsent() {
  return hasConsentCategory("analytics");
}

export function intelligenceSessionId() {
  if (!hasAnalyticsConsent()) return null;
  let id = sessionStorage.getItem(sessionKey);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(sessionKey, id);
  }
  return id;
}

const device = () =>
  window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop";

export function trackIntelligence(event: IntelligenceEvent) {
  if (!hasAnalyticsConsent()) return;
  const productId =
    event.productId && uuidPattern.test(event.productId) ? event.productId : undefined;
  const variantId =
    event.variantId && uuidPattern.test(event.variantId) ? event.variantId : undefined;
  queue.push({
    ...event,
    productId,
    variantId,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    device: device(),
    path: event.path ?? location.pathname.slice(0, 200)
  });
  if (queue.length >= maxBatch) void flushIntelligence();
  else if (timer === undefined) timer = window.setTimeout(() => void flushIntelligence(), 8_000);
}

export async function flushIntelligence(beacon = false) {
  if (flushing || !hasAnalyticsConsent() || queue.length === 0) return;
  const sessionId = intelligenceSessionId();
  if (!sessionId) return;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  const events = queue.splice(0, maxBatch);
  const body = JSON.stringify({ sessionId, consent: true, events });
  if (
    beacon &&
    navigator.sendBeacon?.(
      "/api/intelligence/events",
      new Blob([body], { type: "application/json" })
    )
  )
    return;
  flushing = true;
  try {
    const response = await fetch("/api/intelligence/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      cache: "no-store"
    });
    if (!response.ok && response.status >= 500) queue = [...events, ...queue].slice(0, 50);
  } catch {
    queue = [...events, ...queue].slice(0, 50);
  } finally {
    flushing = false;
    if (queue.length > 0 && timer === undefined)
      timer = window.setTimeout(() => void flushIntelligence(), 8_000);
  }
}

export function applyIntelligenceConsent() {
  if (hasAnalyticsConsent()) {
    trackIntelligence({ type: "page_view" });
    return;
  }
  const sessionId = sessionStorage.getItem(sessionKey);
  if (sessionId)
    void fetch("/api/intelligence/events", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
      keepalive: true
    }).catch(() => undefined);
  queue = [];
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  sessionStorage.removeItem(sessionKey);
  localStorage.removeItem(recentKey);
}

export function rememberViewedProduct(productId: string) {
  if (!hasAnalyticsConsent()) return;
  try {
    const current: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    const ids = Array.isArray(current)
      ? current.filter((id): id is string => typeof id === "string" && id !== productId)
      : [];
    localStorage.setItem(recentKey, JSON.stringify([productId, ...ids].slice(0, 20)));
  } catch {
    localStorage.setItem(recentKey, JSON.stringify([productId]));
  }
}

export function recentlyViewedProductIds() {
  if (!hasAnalyticsConsent()) return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((id): id is string => typeof id === "string" && uuidPattern.test(id))
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
