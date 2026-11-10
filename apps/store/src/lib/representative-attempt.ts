type PendingAttempt = { fingerprint: string; key: string };

export async function fetchRepresentativeJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000
): Promise<{ response: Response; result: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const result = (await response.json()) as T;
    return { response, result };
  } finally {
    clearTimeout(timeout);
  }
}

export async function withRepresentativeSaleLock<T>(
  locks: LockManager | undefined,
  scope: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!locks) throw new Error("Seu navegador não permite proteger esta operação. Atualize-o para continuar.");
  return locks.request(`curtiz:representative-sale:${scope}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Há uma operação de venda em andamento em outra aba. Aguarde e tente novamente.");
    return operation();
  });
}

export function shouldClearRepresentativeAttempt(isRetry: boolean, status: number): boolean {
  return (status >= 200 && status < 300) || (!isRetry && [400, 401, 403, 422].includes(status));
}

function readPending(storage: Storage, storageKey: string): PendingAttempt | null {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "fingerprint" in value && "key" in value &&
        typeof value.fingerprint === "string" && typeof value.key === "string") {
      return { fingerprint: value.fingerprint, key: value.key };
    }
  } catch {
    // Treat malformed storage as an unresolved attempt, not as permission to retry with a new key.
  }
  throw new Error("Não foi possível recuperar a tentativa anterior. Consulte o histórico antes de continuar.");
}

export function pendingRepresentativeAttempt(storage: Storage, scope: string) {
  const storageKey = `curtiz:representative-attempt:${scope}`;
  const pending = readPending(storage, storageKey);
  if (!pending) return null;
  return {
    key: pending.key,
    clear: () => {
      if (storage.getItem(storageKey) === JSON.stringify(pending)) storage.removeItem(storageKey);
    }
  };
}

// Only a digest and an opaque key are persisted; the sale itself can contain
// private customer references and must not be stored in browser storage.
export async function representativeAttempt(
  storage: Storage,
  scope: string,
  payload: Record<string, unknown>
) {
  const storageKey = `curtiz:representative-attempt:${scope}`;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const pending = readPending(storage, storageKey);
  if (pending && pending.fingerprint !== fingerprint) {
    throw new Error("Há uma tentativa sem confirmação. Repita os mesmos dados e consulte o histórico antes de alterá-los.");
  }
  const attempt = pending ?? { fingerprint, key: crypto.randomUUID() };
  storage.setItem(storageKey, JSON.stringify(attempt));
  return {
    key: attempt.key,
    isRetry: pending !== null,
    clear: () => {
      if (storage.getItem(storageKey) === JSON.stringify(attempt)) storage.removeItem(storageKey);
    }
  };
}
