import "server-only";

export type BlingTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export interface BlingTokenStore {
  load(this: void, includeExpired?: boolean): Promise<BlingTokens | null>;
  saveConnected(this: void, tokens: BlingTokens): Promise<void>;
  claimRefresh(this: void, lockId: string): Promise<boolean>;
  saveRefresh(this: void, tokens: BlingTokens, lockId: string): Promise<boolean>;
  releaseRefresh(this: void, lockId: string): Promise<void>;
  markReconnectRequired(this: void): Promise<void>;
  disconnect(this: void, lockId: string): Promise<boolean>;
  reserveRequest(this: void, oauth?: boolean): Promise<number>;
}

export type EncryptedBlingTokens = {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

const binary = (value: Uint8Array): string => btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
const bytes = (value: string): Uint8Array => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const cipherKey = async (encoded: string) => {
  let decoded: Uint8Array;
  try { decoded = bytes(encoded); } catch { throw new BlingError("configuration", 503); }
  if (decoded.length !== 32) throw new BlingError("configuration", 503);
  return crypto.subtle.importKey("raw", Uint8Array.from(decoded), "AES-GCM", false, ["encrypt", "decrypt"]);
};
export async function encryptBlingToken(value: string, encodedKey: string): Promise<string> {
  if (!value) throw new BlingError("invalid_token", 502);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv },
    await cipherKey(encodedKey), new TextEncoder().encode(value)));
  return `v1.${binary(iv)}.${binary(encrypted)}`;
}
export async function decryptBlingToken(value: string, encodedKey: string): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new BlingError("invalid_token_store", 503);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Uint8Array.from(bytes(iv)) },
      await cipherKey(encodedKey), Uint8Array.from(bytes(ciphertext))));
  } catch { throw new BlingError("invalid_token_store", 503); }
}

export function createBlingTokenStore(input: {
  encryptionKey: string;
  environment: "sandbox" | "production";
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}): BlingTokenStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await input.rpc(name, args);
    if (response.error) throw new BlingError("storage_unavailable", 503, true);
    return response.data;
  };
  const params = { p_environment: input.environment };
  const encrypted = async (tokens: BlingTokens) => ({
    p_access_token_ciphertext: await encryptBlingToken(tokens.accessToken, input.encryptionKey),
    p_refresh_token_ciphertext: await encryptBlingToken(tokens.refreshToken, input.encryptionKey),
    p_access_token_expires_at: tokens.accessTokenExpiresAt,
    p_refresh_token_expires_at: tokens.refreshTokenExpiresAt
  });
  return {
    async load(includeExpired = false) {
      const row = record(await call("read_integration_credential", { p_provider: "bling", ...params }));
      if (!row || (row.status !== "connected" && !(includeExpired && row.status === "refresh_required"))) return null;
      return {
        accessToken: await decryptBlingToken(text(row.access_token_ciphertext), input.encryptionKey),
        refreshToken: await decryptBlingToken(text(row.refresh_token_ciphertext), input.encryptionKey),
        accessTokenExpiresAt: text(row.access_token_expires_at),
        refreshTokenExpiresAt: text(row.refresh_token_expires_at)
      };
    },
    async saveConnected(tokens) { await call("save_bling_connection", { ...params, ...await encrypted(tokens) }); },
    async claimRefresh(lockId) {
      return await call("claim_integration_refresh", { p_provider: "bling", ...params, p_lock_id: lockId }) === true;
    },
    async saveRefresh(tokens, lockId) {
      return await call("save_bling_refresh", { ...params, p_lock_id: lockId, ...await encrypted(tokens) }) === true;
    },
    async releaseRefresh(lockId) {
      await call("release_integration_refresh", { p_provider: "bling", ...params, p_lock_id: lockId });
    },
    async markReconnectRequired() { await call("mark_bling_reconnect_required", params); },
    async disconnect(lockId) { return await call("disconnect_bling_connection", { ...params, p_lock_id: lockId }) === true; },
    async reserveRequest(oauth = false) {
      const result = await call("claim_bling_request_slot", { ...params, p_oauth: oauth });
      if (typeof result !== "number" || result < 0) throw new BlingError("rate_unavailable", 503, true);
      return result;
    }
  };
}

export function createBlingClient(values: Readonly<Record<string, string | undefined>>,
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
  transport?: typeof fetch): BlingClient {
  const encryptionKey = values.BLING_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const clientId = values.BLING_CLIENT_ID?.trim() ?? "";
  const clientSecret = values.BLING_CLIENT_SECRET?.trim() ?? "";
  if (!encryptionKey || !clientId || !clientSecret) throw new BlingError("configuration", 503);
  try { if (bytes(encryptionKey).length !== 32) throw new Error("invalid_key"); }
  catch { throw new BlingError("configuration", 503); }
  const store = createBlingTokenStore({ encryptionKey,
    environment: values.APP_ENV === "production" ? "production" : "sandbox", rpc });
  return new BlingClient({ clientId, clientSecret }, store, transport);
}

export class BlingError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryable = false,
    readonly uncertainWrite = false, readonly retryAfterMs = 0) {
    super(code);
    this.name = "BlingError";
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const base = "https://api.bling.com.br/Api/v3";
const authorize = "https://www.bling.com.br/Api/v3/oauth/authorize";

export function blingAuthorizationUrl(clientId: string, state: string): string {
  if (!clientId || !/^[A-Za-z0-9_-]{32,256}$/u.test(state)) throw new BlingError("configuration", 503);
  const url = new URL(authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function verifyBlingSignature(body: Uint8Array, signature: string | null, clientSecret: string): Promise<boolean> {
  if (!clientSecret || !/^sha256=[a-f0-9]{64}$/iu.test(signature ?? "")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, Uint8Array.from(body)));
  const expected = signature!.slice(7).toLowerCase();
  let difference = 0;
  for (let i = 0; i < 32; i += 1) difference |= (digest[i] ?? 0) ^ Number.parseInt(expected.slice(i * 2, i * 2 + 2), 16);
  return difference === 0;
}

export class BlingClient {
  private pendingConnection: BlingTokens | null = null;
  constructor(private readonly config: { clientId: string; clientSecret: string },
    private readonly store: BlingTokenStore, private readonly transport: typeof fetch = fetch) {
    if (!config.clientId || !config.clientSecret) throw new BlingError("configuration", 503);
  }

  private async slot(oauth = false): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const waitMs = await this.store.reserveRequest(oauth);
      if (waitMs === 0) return;
      if (!Number.isFinite(waitMs) || waitMs > 60_000) throw new BlingError("rate_limited", 429, true, false, waitMs);
      await pause(Math.max(50, waitMs));
    }
    throw new BlingError("rate_limited", 429, true, false, 1_000);
  }

  private async token(grantType: "authorization_code" | "refresh_token", value: string): Promise<BlingTokens> {
    await this.slot(true);
    const form = new URLSearchParams({ grant_type: grantType,
      [grantType === "authorization_code" ? "code" : "refresh_token"]: value });
    let response: Response;
    try {
      response = await this.transport(`${base}/oauth/token`, { method: "POST", body: form,
        headers: { authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
          "content-type": "application/x-www-form-urlencoded", "enable-jwt": "1", accept: "1.0" },
        signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      if (error instanceof BlingError) throw error;
      throw new BlingError("token_unavailable", 503, true);
    }
    if (!response.ok) throw new BlingError(response.status === 400 || response.status === 401 ? "reconnect_required" : "token_unavailable",
      response.status, response.status >= 500 || response.status === 429);
    const result = record(await response.json().catch(() => null));
    const seconds = Number(result?.expires_in);
    if (!result || !text(result.access_token) || !text(result.refresh_token) || !Number.isFinite(seconds) || seconds <= 0)
      throw new BlingError("invalid_token_response", 502);
    return { accessToken: text(result.access_token), refreshToken: text(result.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + seconds * 1_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString() };
  }

  async exchangeCode(code: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(code)) throw new BlingError("invalid_code", 400);
    this.pendingConnection = await this.token("authorization_code", code);
  }

  async completeConnection(): Promise<void> {
    if (!this.pendingConnection) throw new BlingError("connection_not_verified", 409);
    await this.store.saveConnected(this.pendingConnection);
    this.pendingConnection = null;
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    if (this.pendingConnection && !forceRefresh) return this.pendingConnection.accessToken;
    const current = await this.store.load();
    if (!current) throw new BlingError("reconnect_required", 401);
    if (!forceRefresh && Date.parse(current.accessTokenExpiresAt) > Date.now() + 120_000) return current.accessToken;
    const lockId = crypto.randomUUID();
    if (!await this.store.claimRefresh(lockId)) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await pause(350 + attempt * 100);
        const updated = await this.store.load();
        if (updated && updated.accessToken !== current.accessToken && Date.parse(updated.accessTokenExpiresAt) > Date.now() + 30_000)
          return updated.accessToken;
      }
      throw new BlingError("refresh_busy", 503, true);
    }
    try {
      const updated = await this.store.load();
      if (updated && updated.accessToken !== current.accessToken && Date.parse(updated.accessTokenExpiresAt) > Date.now() + 30_000)
        return updated.accessToken;
      if (!updated) throw new BlingError("reconnect_required", 401);
      if (!Number.isFinite(Date.parse(updated.refreshTokenExpiresAt)) || Date.parse(updated.refreshTokenExpiresAt) <= Date.now()) {
        await this.store.markReconnectRequired();
        throw new BlingError("reconnect_required", 401);
      }
      const tokens = await this.token("refresh_token", updated.refreshToken).catch(async (error: unknown) => {
        if (error instanceof BlingError && error.code === "reconnect_required") await this.store.markReconnectRequired();
        throw error;
      });
      if (!await this.store.saveRefresh(tokens, lockId)) throw new BlingError("refresh_conflict", 503, true);
      return tokens.accessToken;
    } finally { await this.store.releaseRefresh(lockId); }
  }

  async revoke(): Promise<void> {
    if (!await this.store.load(true)) return;
    const lockId = crypto.randomUUID();
    if (!await this.store.claimRefresh(lockId)) throw new BlingError("refresh_busy", 503, true);
    try {
    await this.store.markReconnectRequired();
    const tokens = await this.store.load(true);
    if (!tokens) throw new BlingError("revocation_unconfirmed", 503);
    for (const [hint, token] of [["access_token", tokens.accessToken], ["refresh_token", tokens.refreshToken]]) {
      await this.slot();
      const response = await this.transport(`${base}/oauth/revoke`, { method: "POST",
      headers: { authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
        "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: token ?? "", token_type_hint: hint ?? "" }),
      signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!response?.ok) throw new BlingError("revocation_unconfirmed", 503, true);
    }
    if (!await this.store.disconnect(lockId)) throw new BlingError("revocation_conflict", 409);
    } finally { await this.store.releaseRefresh(lockId); }
  }

  async request(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new BlingError("invalid_path", 400);
    const method = options.method ?? "GET";
    if (this.pendingConnection && method !== "GET") throw new BlingError("connection_not_verified", 409);
    const maxAttempts = method === "GET" ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const accessToken = await this.accessToken();
      await this.slot();
      let response: Response;
      try {
        response = await this.transport(`${base}${path}`, { method,
          headers: { authorization: `Bearer ${accessToken}`, "enable-jwt": "1", accept: "application/json",
            ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
          body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(12_000) });
      } catch (error) {
        if (error instanceof BlingError) throw error;
        if (method !== "GET") throw new BlingError("uncertain_write", 503, false, true);
        if (attempt + 1 < maxAttempts) { await pause(300 * 2 ** attempt + Math.random() * 150); continue; }
        throw new BlingError("network_error", 503, true);
      }
      if (response.status === 401) {
        if (attempt === 0 && method === "GET") { await this.accessToken(true); continue; }
        throw new BlingError("reconnect_required", 401);
      }
      if (!response.ok) {
        const header = response.headers.get("retry-after");
        const retryAfter = header && /^\d+$/u.test(header) ? Number(header) * 1_000
          : header ? Date.parse(header) - Date.now() : 0;
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 500 * 2 ** attempt + Math.random() * 250;
        if (method === "GET" && (response.status === 429 || response.status >= 500) && attempt + 1 < maxAttempts) {
          if (waitMs > 15_000) throw new BlingError("rate_limited", response.status, true, false, waitMs);
          await pause(waitMs); continue;
        }
        if (method !== "GET" && response.status >= 500) throw new BlingError("uncertain_write", response.status, false, true);
        throw new BlingError(response.status === 429 ? "rate_limited" : response.status === 403 ? "scope_denied"
          : response.status === 400 || response.status === 422 ? "validation_error" : "provider_error",
        response.status, response.status === 429 || response.status >= 500, false, waitMs);
      }
      if (response.status === 204) return null;
      return await response.json().catch(() => { throw new BlingError(method === "GET" ? "invalid_response" : "uncertain_write", 502, false, method !== "GET"); });
    }
    throw new BlingError("provider_error", 503, true);
  }

  async invoiceDocument(accessKey: string): Promise<ArrayBuffer> {
    if (!/^\d{44}$/u.test(accessKey)) throw new BlingError("invalid_document", 400);
    const result = record(await this.request(`/nfe/documento/${accessKey}?formato=pdf`));
    const documents = Array.isArray(result?.data) ? result.data : [];
    const content = documents.length === 1 ? text(record(documents[0])?.conteudo) : "";
    if (!content || content.length > 14_000_000) throw new BlingError("invalid_document", 502);
    try {
      const stream = new Blob([Uint8Array.from(bytes(content))]).stream().pipeThrough(new DecompressionStream("gzip"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 10_000_000) { await reader.cancel(); throw new Error("document_too_large"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const pdf = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { pdf.set(chunk, offset); offset += chunk.byteLength; }
      if (new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") throw new Error("not_pdf");
      return pdf.buffer;
    } catch { throw new BlingError("invalid_document", 502); }
  }
}
