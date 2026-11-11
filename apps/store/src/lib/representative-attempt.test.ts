import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepresentativeJson, pendingRepresentativeAttempt, representativeAttempt, shouldClearRepresentativeAttempt, withRepresentativeSaleLock } from "./representative-attempt";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); }
  };
}

describe("representative attempts", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("reuses the key after an uncertain result and never stores sale data", async () => {
    const storage = memoryStorage();
    const payload = { action: "record_sale", customerReference: "PRIVATE", items: [{ quantity: 1 }] };
    const first = await representativeAttempt(storage, "rep:sale", payload);
    const retry = await representativeAttempt(storage, "rep:sale", payload);
    expect(first.isRetry).toBe(false);
    expect(retry.isRetry).toBe(true);
    expect(retry.key).toBe(first.key);
    expect(pendingRepresentativeAttempt(storage, "rep:sale")?.key).toBe(first.key);
    expect(storage.getItem("curtiz:representative-attempt:rep:sale")).not.toContain("PRIVATE");
    await expect(representativeAttempt(storage, "rep:sale", { ...payload, items: [] })).rejects.toThrow("sem confirmação");
    retry.clear();
    const next = await representativeAttempt(storage, "rep:sale", payload);
    expect(next.key).not.toBe(first.key);
  });

  it("fails closed if browser storage is unavailable", async () => {
    const storage = memoryStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await expect(representativeAttempt(storage, "rep:kit", { kitId: "kit" })).rejects.toThrow("blocked");
  });

  it("never discards an unreadable pending attempt", () => {
    const storage = memoryStorage();
    storage.setItem("curtiz:representative-attempt:rep:sale", "invalid");
    expect(() => pendingRepresentativeAttempt(storage, "rep:sale")).toThrow("histórico");
    expect(storage.getItem("curtiz:representative-attempt:rep:sale")).toBe("invalid");
  });

  it("keeps the key when an earlier request might have completed", () => {
    expect(shouldClearRepresentativeAttempt(false, 422)).toBe(true);
    expect(shouldClearRepresentativeAttempt(true, 422)).toBe(false);
    expect(shouldClearRepresentativeAttempt(true, 401)).toBe(false);
    expect(shouldClearRepresentativeAttempt(false, 503)).toBe(false);
    expect(shouldClearRepresentativeAttempt(true, 207)).toBe(true);
  });

  it("rejects concurrent sale operations in another tab", async () => {
    let held = false;
    const locks = {
      request: async (_name: string, _options: unknown, callback: (lock: Lock | null) => Promise<unknown>) => {
        if (held) return callback(null);
        held = true;
        try { return await callback({ name: "sale", mode: "exclusive" }); }
        finally { held = false; }
      }
    } as unknown as LockManager;
    let finish: () => void = () => { throw new Error("test lock not acquired"); };
    const pending = withRepresentativeSaleLock(locks, "rep", () => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(withRepresentativeSaleLock(locks, "rep", async () => "duplicate")).rejects.toThrow("outra aba");
    finish();
    await pending;
    await expect(withRepresentativeSaleLock(locks, "rep", async () => "ok")).resolves.toBe("ok");
  });

  it("does not submit when cross-tab locking is unavailable", async () => {
    const operation = vi.fn();
    await expect(withRepresentativeSaleLock(undefined, "rep", operation)).rejects.toThrow("navegador");
    expect(operation).not.toHaveBeenCalled();
  });

  it("times out an unresponsive request without discarding its idempotency key", async () => {
    const storage = memoryStorage();
    const attempt = await representativeAttempt(storage, "rep:sale", { action: "record_sale" });
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    })));
    const request = fetchRepresentativeJson("/api/representatives", { method: "POST" });
    const rejected = expect(request).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(pendingRepresentativeAttempt(storage, "rep:sale")?.key).toBe(attempt.key);
  });
});
