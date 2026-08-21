import { describe, expect, it, vi } from "vitest";
import {
  PERSISTENT_CART_KEY,
  PERSISTENT_CART_SYNC_KEY,
  SESSION_CART_KEY,
  SESSION_CART_SYNC_KEY,
  clearClientSessionState,
  readClientPersistence,
  setClientAuthPersistence
} from "./session-persistence-client";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("armazenamento da sessão e do carrinho", () => {
  it("move o carrinho autenticado para sessionStorage quando não deve persistir", () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(PERSISTENT_CART_KEY, "cart");
    local.setItem(PERSISTENT_CART_SYNC_KEY, "sync");
    setClientAuthPersistence(false, local, session);
    expect(local.getItem(PERSISTENT_CART_KEY)).toBeNull();
    expect(local.getItem(PERSISTENT_CART_SYNC_KEY)).toBeNull();
    expect(session.getItem(SESSION_CART_KEY)).toBe("cart");
    expect(session.getItem(SESSION_CART_SYNC_KEY)).toBe("sync");
    expect(readClientPersistence(session)).toBe("session");
  });

  it("restaura armazenamento persistente somente quando escolhido", () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    session.setItem(SESSION_CART_KEY, "cart");
    setClientAuthPersistence(true, local, session);
    expect(local.getItem(PERSISTENT_CART_KEY)).toBe("cart");
    expect(session.getItem(SESSION_CART_KEY)).toBeNull();
    expect(readClientPersistence(session)).toBe("persistent");
  });

  it("logout limpa marcadores e carrinhos locais sem tocar em pedidos", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(PERSISTENT_CART_KEY, "cart");
    session.setItem(SESSION_CART_KEY, "cart");
    clearClientSessionState(local, session);
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "curtiz-session-state-cleared" })
    );
  });
});
