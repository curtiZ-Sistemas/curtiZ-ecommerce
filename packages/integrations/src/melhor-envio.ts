export type MelhorEnvioEnvironment = "sandbox" | "production";

export type MelhorEnvioTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
};

export interface MelhorEnvioTokenStore {
  read(): Promise<MelhorEnvioTokens | null>;
  write(tokens: MelhorEnvioTokens): Promise<void>;
  withRefreshLock<T>(operation: () => Promise<T>): Promise<T>;
}

export type EncryptedMelhorEnvioTokenRecord = {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string | null;
};

export type MelhorEnvioCiphertextPair = Pick<EncryptedMelhorEnvioTokenRecord, "accessTokenCiphertext" | "refreshTokenCiphertext">;

/** Somente identificadores públicos (impressões digitais) de chave; nunca chaves, tokens ou ciphertexts. */
export type MelhorEnvioKeyRotationEvent = {
  event: "melhor_envio_token_reencrypted" | "melhor_envio_token_reencryption_skipped" | "melhor_envio_token_reencryption_failed";
  fromKeyIds: string[];
  toKeyId: string;
};

export type MelhorEnvioCredentialKeyStatus =
  | { state: "missing"; activeKeyId: string }
  | {
    state: "readable" | "key_unavailable" | "decryption_failed";
    activeKeyId: string;
    recordFormats: Array<"v1" | "v2" | "invalid">;
    recordKeyIds: string[];
    reencryptionPending: boolean;
  };

export function createEncryptedMelhorEnvioTokenStore(input: {
  encryptionKey: string;
  /** Chaves antigas aceitas somente para leitura; nunca cifram registros novos. */
  previousEncryptionKeys?: readonly string[];
  load: () => Promise<EncryptedMelhorEnvioTokenRecord | null>;
  save: (record: EncryptedMelhorEnvioTokenRecord) => Promise<void>;
  claimRefreshLock: (lockId: string) => Promise<boolean>;
  releaseRefreshLock: (lockId: string) => Promise<void>;
  /** Troca os ciphertexts somente se ainda forem os lidos (CAS); `false` quando outro fluxo gravou antes. */
  replaceCiphertexts?: (expected: MelhorEnvioCiphertextPair, next: MelhorEnvioCiphertextPair) => Promise<boolean>;
  onKeyRotation?: (event: MelhorEnvioKeyRotationEvent) => void;
}): MelhorEnvioTokenStore & { inspect(): Promise<MelhorEnvioCredentialKeyStatus> } {
  let keyring: Promise<TokenKeyring> | null = null;
  const keys = () => keyring ??= createTokenKeyring(input.encryptionKey, input.previousEncryptionKeys ?? []);
  const report = (event: MelhorEnvioKeyRotationEvent) => {
    try { input.onKeyRotation?.(event); } catch { /* telemetria nunca altera a leitura dos tokens */ }
  };
  // Recifra com a chave ativa sem bloquear a leitura: falhas e corridas mantêm o registro original intacto.
  const reencrypt = async (record: EncryptedMelhorEnvioTokenRecord, tokens: MelhorEnvioTokens, ring: TokenKeyring, fromKeyIds: string[]) => {
    if (!input.replaceCiphertexts) return;
    const event = { fromKeyIds, toKeyId: ring.active.id };
    try {
      const replaced = await input.replaceCiphertexts({
        accessTokenCiphertext: record.accessTokenCiphertext, refreshTokenCiphertext: record.refreshTokenCiphertext
      }, {
        accessTokenCiphertext: await sealToken(tokens.accessToken, ring.active),
        refreshTokenCiphertext: await sealToken(tokens.refreshToken, ring.active)
      });
      report({ ...event, event: replaced ? "melhor_envio_token_reencrypted" : "melhor_envio_token_reencryption_skipped" });
    } catch {
      report({ ...event, event: "melhor_envio_token_reencryption_failed" });
    }
  };
  return {
    async read() {
      const record = await input.load();
      if (!record) return null;
      const ring = await keys();
      const access = await openToken(record.accessTokenCiphertext, ring);
      const refresh = await openToken(record.refreshTokenCiphertext, ring);
      const tokens = {
        accessToken: access.value,
        refreshToken: refresh.value,
        accessTokenExpiresAt: record.accessTokenExpiresAt,
        refreshTokenExpiresAt: record.refreshTokenExpiresAt
      };
      if (!isCurrentCiphertext(access, ring) || !isCurrentCiphertext(refresh, ring)) {
        await reencrypt(record, tokens, ring, [...new Set([access.keyId, refresh.keyId])]);
      }
      return tokens;
    },
    async write(tokens) {
      const ring = await keys();
      await input.save({
        accessTokenCiphertext: await sealToken(tokens.accessToken, ring.active),
        refreshTokenCiphertext: await sealToken(tokens.refreshToken, ring.active),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
      });
    },
    async inspect() {
      const ring = await keys();
      const record = await input.load();
      if (!record) return { state: "missing", activeKeyId: ring.active.id };
      const ciphertexts = [record.accessTokenCiphertext, record.refreshTokenCiphertext];
      const declared = ciphertexts.map(describeCiphertext);
      try {
        const opened = await Promise.all(ciphertexts.map((value) => openToken(value, ring)));
        return { state: "readable", activeKeyId: ring.active.id, recordFormats: declared.map((item) => item.format),
          recordKeyIds: [...new Set(opened.map((item) => item.keyId))],
          reencryptionPending: opened.some((item) => !isCurrentCiphertext(item, ring)) };
      } catch (error) {
        const reason = error instanceof MelhorEnvioError ? error.diagnostic.reason : undefined;
        return { state: reason === "token_key_unavailable" ? "key_unavailable" : "decryption_failed",
          activeKeyId: ring.active.id, recordFormats: declared.map((item) => item.format),
          recordKeyIds: [...new Set(declared.flatMap((item) => item.keyId ? [item.keyId] : []))], reencryptionPending: true };
      }
    },
    async withRefreshLock(operation) {
      const lockId = crypto.randomUUID();
      const deadline = Date.now() + 10_000;
      while (!(await input.claimRefreshLock(lockId))) {
        if (Date.now() >= deadline) throw new MelhorEnvioError("provider_unavailable", 503, true, { reason: "refresh_lock_timeout" });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      try { return await operation(); }
      finally { await input.releaseRefreshLock(lockId); }
    }
  };
}

export type MelhorEnvioConfig = {
  environment: MelhorEnvioEnvironment;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  applicationName: string;
  technicalContact: string;
  timeoutMs?: number;
  legacyBaseUrl?: string;
};

export type MelhorEnvioQuoteProduct = {
  id: string;
  quantity: number;
  weightKg: number;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  insuranceValue: number;
};

export type MelhorEnvioQuote = {
  provider: "melhorenvio";
  serviceId: string;
  service: string;
  carrier: string;
  amountInCents: number;
  costInCents: number;
  estimatedDays: number;
  packages: unknown[];
  expiresAt: string;
};

export type MelhorEnvioParty = {
  name: string;
  email: string;
  phone: string;
  document?: string;
  company_document?: string;
  state_register?: string;
  economic_activity_code?: string;
  address: string;
  complement?: string;
  number: string;
  district: string;
  city: string;
  postal_code: string;
  state_abbr: string;
  country_id?: "BR";
};

export type MelhorEnvioShipmentInput = {
  serviceId: string;
  from: MelhorEnvioParty;
  to: MelhorEnvioParty;
  products: Array<{ name: string; quantity: number; unitary_value: number }>;
  volumes: Array<{ height: number; width: number; length: number; weight: number }>;
  options: {
    platform: string;
    insurance_value: number;
    receipt: boolean;
    own_hand: boolean;
    reverse: boolean;
    tags: Array<{ tag: string; url: string | null }>;
    invoice?: { key: string; xml_content?: string };
    dce?: { key: string };
  };
};

type JsonObject = Record<string, unknown>;

const HOSTS: Record<MelhorEnvioEnvironment, string> = {
  sandbox: "https://sandbox.melhorenvio.com.br",
  production: "https://melhorenvio.com.br"
};

const asObject = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
const finiteNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export type MelhorEnvioFailureReason =
  | "credentials_missing" | "credentials_read_failed" | "credentials_write_failed"
  | "token_decryption_failed" | "token_key_unavailable" | "refresh_token_expired" | "oauth_rejected"
  | "permission_denied" | "refresh_lock_failed" | "refresh_lock_timeout";

export type MelhorEnvioFailureDetails = {
  reason?: MelhorEnvioFailureReason;
  upstreamStatus?: number;
  databaseCode?: string;
};

export class MelhorEnvioError extends Error {
  constructor(
    readonly code: "configuration" | "authentication" | "not_found" | "conflict" | "validation" |
      "rate_limited" | "provider_unavailable" | "network" | "timeout" | "invalid_response" |
      "uncertain_write" | "fiscal_shipping_blocked",
    readonly httpStatus: number,
    readonly retryable: boolean,
    readonly diagnostic: MelhorEnvioFailureDetails = {}
  ) {
    super(code);
    this.name = "MelhorEnvioError";
  }
}

export function melhorEnvioBaseUrl(config: Pick<MelhorEnvioConfig, "environment" | "legacyBaseUrl">): string {
  const expected = HOSTS[config.environment];
  if (!expected) throw new MelhorEnvioError("configuration", 503, false);
  if (config.legacyBaseUrl) {
    let legacy: URL;
    try { legacy = new URL(config.legacyBaseUrl); }
    catch { throw new MelhorEnvioError("configuration", 503, false); }
    if (legacy.origin !== expected || legacy.pathname !== "/" || legacy.search || legacy.hash) {
      throw new MelhorEnvioError("configuration", 503, false);
    }
  }
  return expected;
}

const validateConfig = (config: MelhorEnvioConfig) => {
  const baseUrl = melhorEnvioBaseUrl(config);
  if (!config.clientId.trim() || !config.clientSecret.trim() || !config.redirectUri.trim()
    || !config.applicationName.trim() || !/^\S+@\S+\.\S+$/u.test(config.technicalContact.trim())) {
    throw new MelhorEnvioError("configuration", 503, false);
  }
  let redirect: URL;
  try { redirect = new URL(config.redirectUri); }
  catch { throw new MelhorEnvioError("configuration", 503, false); }
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    throw new MelhorEnvioError("configuration", 503, false);
  }
  return baseUrl;
};

const providerError = (status: number, safeWrite: boolean) => {
  if (status === 400 || status === 422) return new MelhorEnvioError("validation", status, false);
  if (status === 401 || status === 403) return new MelhorEnvioError("authentication", status, false);
  if (status === 404) return new MelhorEnvioError("not_found", status, false);
  if (status === 409) return new MelhorEnvioError("conflict", status, false);
  if (status === 429) return new MelhorEnvioError("rate_limited", status, safeWrite);
  return new MelhorEnvioError(safeWrite ? "provider_unavailable" : "uncertain_write", status, safeWrite);
};

const tokenResponse = (value: unknown): MelhorEnvioTokens => {
  const body = asObject(value);
  const accessToken = stringValue(body?.access_token);
  const refreshToken = stringValue(body?.refresh_token);
  const expiresIn = finiteNumber(body?.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new MelhorEnvioError("invalid_response", 502, false);
  }
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + 45 * 24 * 60 * 60 * 1000).toISOString()
  };
};

export class MelhorEnvioProvider {
  readonly name = "melhorenvio";
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: MelhorEnvioConfig, private readonly tokens: MelhorEnvioTokenStore) {
    this.baseUrl = validateConfig(config);
    this.timeoutMs = Math.min(Math.max(config.timeoutMs ?? 15_000, 1_000), 30_000);
  }

  authorizationUrl(state: string, scopes: string[]): string {
    if (!/^[A-Za-z0-9_-]{32,256}$/u.test(state) || scopes.length === 0) {
      throw new MelhorEnvioError("configuration", 503, false);
    }
    const url = new URL("/oauth/authorize", this.baseUrl);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scopes.join(" "));
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<MelhorEnvioTokens> {
    if (!code.trim()) throw new MelhorEnvioError("validation", 400, false);
    const result = await this.oauthRequest({
      grant_type: "authorization_code", client_id: this.config.clientId,
      client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, code
    });
    const next = tokenResponse(result);
    await this.tokens.write(next);
    return next;
  }

  private async oauthRequest(body: Record<string, string>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL("/oauth/token", this.baseUrl), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": this.userAgent },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw new MelhorEnvioError("timeout", 504, true);
      throw new MelhorEnvioError("network", 503, true);
    }
    const result: unknown = await response.json().catch(() => null);
    // OAuth 400/422 describes the application/token, never the customer's CEP/cart.
    if (!response.ok) {
      if ([400, 401, 403, 422].includes(response.status)) {
        throw new MelhorEnvioError("authentication", response.status, false, {
          reason: "oauth_rejected", upstreamStatus: response.status
        });
      }
      throw providerError(response.status, true);
    }
    return result;
  }

  private get userAgent() { return `${this.config.applicationName} (${this.config.technicalContact})`; }

  private async accessToken(rejectedToken?: string): Promise<string> {
    const current = await this.tokens.read();
    if (!current) throw new MelhorEnvioError("authentication", 503, false, { reason: "credentials_missing" });
    const forceRefresh = rejectedToken !== undefined;
    const alreadyRefreshed = forceRefresh && current.accessToken !== rejectedToken;
    if ((!forceRefresh || alreadyRefreshed) && Date.parse(current.accessTokenExpiresAt) > Date.now() + 60_000) return current.accessToken;
    return this.tokens.withRefreshLock(async () => {
      const latest = await this.tokens.read();
      if (!latest) throw new MelhorEnvioError("authentication", 503, false, { reason: "credentials_missing" });
      const anotherRequestRefreshed = forceRefresh && latest.accessToken !== rejectedToken;
      if ((!forceRefresh || anotherRequestRefreshed) && Date.parse(latest.accessTokenExpiresAt) > Date.now() + 60_000) {
        return latest.accessToken;
      }
      if (latest.refreshTokenExpiresAt && Date.parse(latest.refreshTokenExpiresAt) <= Date.now()) {
        throw new MelhorEnvioError("authentication", 401, false, { reason: "refresh_token_expired" });
      }
      const refreshed = tokenResponse(await this.oauthRequest({
        grant_type: "refresh_token", client_id: this.config.clientId,
        client_secret: this.config.clientSecret, refresh_token: latest.refreshToken
      }));
      await this.tokens.write(refreshed);
      return refreshed.accessToken;
    });
  }

  private async request(path: string, init: RequestInit = {}, safeToRetry = false, refreshed = false): Promise<unknown> {
    const method = init.method ?? "GET";
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          accept: "application/json", ...(method === "GET" ? {} : { "content-type": "application/json" }),
          authorization: `Bearer ${token}`, "user-agent": this.userAgent, ...init.headers
        },
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MelhorEnvioError(safeToRetry ? "timeout" : "uncertain_write", 504, safeToRetry);
      }
      throw new MelhorEnvioError(safeToRetry ? "network" : "uncertain_write", 503, safeToRetry);
    }
    const result: unknown = await response.json().catch(() => null);
    if (response.status === 401 && !refreshed) {
      await this.accessToken(token);
      return this.request(path, init, safeToRetry, true);
    }
    if (!response.ok) {
      const error = providerError(response.status, safeToRetry);
      throw new MelhorEnvioError(error.code, error.httpStatus, error.retryable, {
        upstreamStatus: response.status,
        ...(response.status === 403 ? { reason: "permission_denied" } : response.status === 401 ? { reason: "oauth_rejected" } : {})
      });
    }
    return result;
  }

  async health(): Promise<"online" | "degraded" | "offline" | "not_configured"> {
    try { await this.request("/api/v2/me/shipment/services", {}, true); return "online"; }
    catch (error) { return error instanceof MelhorEnvioError && error.code === "authentication" ? "not_configured" : "offline"; }
  }

  async quote(input: { originPostalCode: string; destinationPostalCode: string; products: MelhorEnvioQuoteProduct[] }): Promise<MelhorEnvioQuote[]> {
    const postal = (value: string) => value.replace(/\D/gu, "");
    if (!/^\d{8}$/u.test(postal(input.originPostalCode)) || !/^\d{8}$/u.test(postal(input.destinationPostalCode))
      || input.products.length === 0 || input.products.some((item) => !item.id || !Number.isInteger(item.quantity)
        || item.quantity <= 0 || [item.weightKg, item.widthCm, item.heightCm, item.lengthCm, item.insuranceValue]
          .some((value) => !Number.isFinite(value) || value <= 0))) {
      throw new MelhorEnvioError("validation", 400, false);
    }
    const result = await this.request("/api/v2/me/shipment/calculate", {
      method: "POST", body: JSON.stringify({
        from: { postal_code: postal(input.originPostalCode) }, to: { postal_code: postal(input.destinationPostalCode) },
        products: input.products.map((item) => ({ id: item.id, quantity: item.quantity, weight: item.weightKg,
          width: item.widthCm, height: item.heightCm, length: item.lengthCm, insurance_value: item.insuranceValue })),
        options: { receipt: false, own_hand: false }
      })
    }, true);
    if (!Array.isArray(result)) throw new MelhorEnvioError("invalid_response", 502, false);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    let malformed = false;
    const quotes = result.flatMap((entry): MelhorEnvioQuote[] => {
      const row = asObject(entry);
      // A service explicitly unavailable is different from a malformed API response.
      if (row?.error) return [];
      const company = asObject(row?.company);
      const serviceId = typeof row?.id === "number" && Number.isFinite(row.id)
        ? String(row.id) : stringValue(row?.id);
      const service = stringValue(row?.name);
      const carrier = stringValue(company?.name);
      const charged = finiteNumber(row?.custom_price ?? row?.price);
      const cost = finiteNumber(row?.price);
      const days = finiteNumber(row?.custom_delivery_time ?? row?.delivery_time);
      const packages = Array.isArray(row?.packages) ? row.packages : [];
      if (!serviceId || !service || !carrier || !Number.isFinite(charged) || charged < 0
        || !Number.isFinite(cost) || cost < 0 || !Number.isInteger(days) || days <= 0 || packages.length === 0) {
        malformed = true;
        return [];
      }
      return [{ provider: "melhorenvio", serviceId, service, carrier,
        amountInCents: Math.round(charged * 100), costInCents: Math.round(cost * 100),
        estimatedDays: days, packages, expiresAt }];
    });
    if (quotes.length === 0 && malformed) throw new MelhorEnvioError("invalid_response", 502, false, { upstreamStatus: 200 });
    return quotes;
  }

  async createShipment(input: MelhorEnvioShipmentInput): Promise<{ externalId: string }> {
    if (!/^\d+$/u.test(input.serviceId)) throw new MelhorEnvioError("validation", 400, false);
    const result = asObject(await this.request("/api/v2/me/cart", {
      method: "POST", body: JSON.stringify({ ...input, service: Number(input.serviceId) })
    }, false));
    const externalId = stringValue(result?.id);
    if (!externalId) throw new MelhorEnvioError("invalid_response", 502, false);
    return { externalId };
  }

  async getShipment(externalId: string): Promise<JsonObject> {
    this.validateExternalIds([externalId]);
    const result = asObject(await this.request(`/api/v2/me/orders/${encodeURIComponent(externalId)}`, {}, true));
    if (!result) throw new MelhorEnvioError("invalid_response", 502, false);
    return result;
  }

  async purchase(externalIds: string[]): Promise<unknown> {
    this.validateExternalIds(externalIds);
    return this.request("/api/v2/me/shipment/checkout", { method: "POST", body: JSON.stringify({ orders: externalIds }) }, false);
  }
  async generate(externalIds: string[]): Promise<unknown> {
    this.validateExternalIds(externalIds);
    return this.request("/api/v2/me/shipment/generate", { method: "POST", body: JSON.stringify({ orders: externalIds }) }, false);
  }
  async preview(externalIds: string[]): Promise<string> {
    return this.labelUrl("/api/v2/me/shipment/preview", externalIds, false);
  }
  async print(externalIds: string[]): Promise<string> {
    return this.labelUrl("/api/v2/me/shipment/print", externalIds, true);
  }
  private async labelUrl(path: string, externalIds: string[], privateMode: boolean): Promise<string> {
    this.validateExternalIds(externalIds);
    const result = asObject(await this.request(path, { method: "POST", body: JSON.stringify({
      orders: externalIds, ...(privateMode ? { mode: "private" } : {})
    }) }, false));
    const value = stringValue(result?.url);
    try {
      const url = new URL(value);
      if (url.origin !== this.baseUrl || url.protocol !== "https:" || url.username || url.password) throw new Error();
      return url.toString();
    } catch { throw new MelhorEnvioError("invalid_response", 502, false); }
  }
  async isCancellable(externalId: string): Promise<boolean> {
    this.validateExternalIds([externalId]);
    const result = await this.request("/api/v2/me/shipment/cancellable", {
      method: "POST", body: JSON.stringify({ orders: [externalId] })
    }, true);
    const row = asObject(result);
    if (typeof row?.cancellable === "boolean") return row.cancellable;
    if (Array.isArray(result)) return result.some((entry) => asObject(entry)?.cancellable === true);
    return false;
  }
  async cancel(externalId: string, description: string): Promise<unknown> {
    this.validateExternalIds([externalId]);
    if (description.trim().length < 3) throw new MelhorEnvioError("validation", 400, false);
    return this.request("/api/v2/me/shipment/cancel", { method: "POST", body: JSON.stringify({
      order: { id: externalId, reason_id: 2, description: description.trim().slice(0, 500) }
    }) }, false);
  }
  async track(externalIds: string[]): Promise<unknown> {
    this.validateExternalIds(externalIds);
    return this.request("/api/v2/me/shipment/tracking", {
      method: "POST", body: JSON.stringify({ orders: externalIds })
    }, true);
  }
  private validateExternalIds(externalIds: string[]) {
    if (externalIds.length === 0 || externalIds.length > 50
      || externalIds.some((id) => !/^[A-Za-z0-9-]{1,100}$/u.test(id))) {
      throw new MelhorEnvioError("validation", 400, false);
    }
  }
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

// Formato v2: `v2.<keyId>.<iv>.<ciphertext>`. O keyId é uma impressão digital pública da chave
// (SHA-256 com separação de domínio, 64 bits) e entra como dado autenticado do AES-GCM.
// O formato legado v1 (`v1.<iv>.<ciphertext>`) não identifica a chave e é somente lido.
const MAX_PREVIOUS_KEYS = 8;
const keyIdPattern = /^[0-9a-f]{16}$/u;
const textBytes = (value: string) => new TextEncoder().encode(value);
const v2AdditionalData = (keyId: string) => asArrayBuffer(textBytes(`curtiz/melhor-envio/token/v2/${keyId}`));
const configurationError = () => new MelhorEnvioError("configuration", 503, false);
const decryptionFailed = () => new MelhorEnvioError("authentication", 503, false, { reason: "token_decryption_failed" });

type TokenKey = { id: string; key: CryptoKey };
type TokenKeyring = { active: TokenKey; accepted: TokenKey[] };
type OpenedToken = { value: string; keyId: string; format: "v1" | "v2" };

const importTokenKey = async (encoded: string): Promise<TokenKey> => {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(encoded.trim()); }
  catch { throw configurationError(); }
  if (bytes.byteLength !== 32) throw configurationError();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",
    asArrayBuffer(Uint8Array.from([...textBytes("curtiz/melhor-envio/token-key-id/v1"), 0, ...bytes]))));
  return {
    id: Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    key: await crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"])
  };
};

async function createTokenKeyring(activeKey: string, previousKeys: readonly string[]): Promise<TokenKeyring> {
  if (!activeKey.trim() || previousKeys.length > MAX_PREVIOUS_KEYS) throw configurationError();
  const active = await importTokenKey(activeKey);
  const accepted = [active];
  for (const encoded of previousKeys) {
    const key = await importTokenKey(encoded);
    if (!accepted.some((item) => item.id === key.id)) accepted.push(key);
  }
  return { active, accepted };
}

/** Chaves antigas separadas por vírgula ou espaço (MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS). */
export function parseMelhorEnvioPreviousKeys(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/u).filter(Boolean);
}

/** Impressão digital pública da chave, a mesma gravada nos ciphertexts v2. */
export async function melhorEnvioTokenKeyId(encodedKey: string): Promise<string> {
  return (await importTokenKey(encodedKey)).id;
}

const describeCiphertext = (value: string): { format: "v1" | "v2" | "invalid"; keyId?: string } => {
  const parts = value.split(".");
  if (parts[0] === "v2" && parts.length === 4 && keyIdPattern.test(parts[1] ?? "") && parts[2] && parts[3]) {
    return { format: "v2", keyId: parts[1] };
  }
  if (parts[0] === "v1" && parts.length === 3 && parts[1] && parts[2]) return { format: "v1" };
  return { format: "invalid" };
};

const aesOpen = async (key: CryptoKey, iv: string, ciphertext: string, additionalData?: ArrayBuffer) =>
  new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(iv)),
    ...(additionalData ? { additionalData } : {}) }, key, asArrayBuffer(base64ToBytes(ciphertext))));

async function openToken(value: string, ring: TokenKeyring): Promise<OpenedToken> {
  const parts = value.split(".");
  const described = describeCiphertext(value);
  if (described.format === "v2") {
    const key = ring.accepted.find((item) => item.id === described.keyId);
    // Chave ausente neste Worker: exige a chave antiga ou reconexão OAuth; o registro não é alterado.
    if (!key) throw new MelhorEnvioError("authentication", 503, false, { reason: "token_key_unavailable" });
    try {
      return { value: await aesOpen(key.key, parts[2] ?? "", parts[3] ?? "", v2AdditionalData(key.id)), keyId: key.id, format: "v2" };
    } catch { throw decryptionFailed(); }
  }
  if (described.format === "v1") {
    // Sem identificador: tenta somente as chaves configuradas explicitamente; a tag GCM rejeita chave errada.
    for (const key of ring.accepted) {
      try { return { value: await aesOpen(key.key, parts[1] ?? "", parts[2] ?? ""), keyId: key.id, format: "v1" }; }
      catch { /* próxima chave configurada */ }
    }
  }
  throw decryptionFailed();
}

const isCurrentCiphertext = (token: OpenedToken, ring: TokenKeyring) => token.format === "v2" && token.keyId === ring.active.id;

async function sealToken(value: string, key: TokenKey): Promise<string> {
  if (!value) throw configurationError();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: v2AdditionalData(key.id) },
    key.key, textBytes(value));
  return `v2.${key.id}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function encryptMelhorEnvioToken(value: string, encodedKey: string): Promise<string> {
  return sealToken(value, (await createTokenKeyring(encodedKey, [])).active);
}

export async function decryptMelhorEnvioToken(value: string, encodedKey: string, previousKeys: readonly string[] = []): Promise<string> {
  return (await openToken(value, await createTokenKeyring(encodedKey, previousKeys))).value;
}
