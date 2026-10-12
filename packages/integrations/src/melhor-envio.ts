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

export function createEncryptedMelhorEnvioTokenStore(input: {
  /** Chave ativa (string) ou chave ativa + anteriores aceitas apenas para leitura. */
  encryptionKey: string | MelhorEnvioTokenKeyring;
  load: () => Promise<EncryptedMelhorEnvioTokenRecord | null>;
  save: (record: EncryptedMelhorEnvioTokenRecord) => Promise<void>;
  claimRefreshLock: (lockId: string) => Promise<boolean>;
  releaseRefreshLock: (lockId: string) => Promise<void>;
  /**
   * Recifra os dois tokens juntos com a chave ativa somente se o registro ainda contiver `expected`
   * (compare-and-swap). Retorna false quando outra instância já alterou o registro.
   */
  replaceCiphertexts?: (expected: MelhorEnvioCiphertextPair, next: MelhorEnvioCiphertextPair) => Promise<boolean>;
  /** Falha não fatal da recifragem: o registro antigo continua íntegro e a próxima leitura tenta de novo. */
  onReencryptionFailure?: (error: unknown) => void;
}): MelhorEnvioTokenStore {
  let keyring: Promise<LoadedKeyring> | null = null;
  const keys = () => {
    keyring ??= loadKeyring(input.encryptionKey);
    keyring.catch(() => { keyring = null; });
    return keyring;
  };
  return {
    async read() {
      const record = await input.load();
      if (!record) return null;
      const loaded = await keys();
      // Os dois tokens precisam decifrar; qualquer falha interrompe antes de qualquer gravação.
      const access = await openToken(record.accessTokenCiphertext, loaded, "access_token");
      const refresh = await openToken(record.refreshTokenCiphertext, loaded, "refresh_token");
      if ((!access.current || !refresh.current) && input.replaceCiphertexts) {
        try {
          await input.replaceCiphertexts({
            accessTokenCiphertext: record.accessTokenCiphertext,
            refreshTokenCiphertext: record.refreshTokenCiphertext
          }, {
            accessTokenCiphertext: await sealToken(access.value, loaded.active, "access_token"),
            refreshTokenCiphertext: await sealToken(refresh.value, loaded.active, "refresh_token")
          });
        } catch (error) {
          input.onReencryptionFailure?.(error);
        }
      }
      return {
        accessToken: access.value,
        refreshToken: refresh.value,
        accessTokenExpiresAt: record.accessTokenExpiresAt,
        refreshTokenExpiresAt: record.refreshTokenExpiresAt
      };
    },
    async write(tokens) {
      const loaded = await keys();
      await input.save({
        accessTokenCiphertext: await sealToken(tokens.accessToken, loaded.active, "access_token"),
        refreshTokenCiphertext: await sealToken(tokens.refreshToken, loaded.active, "refresh_token"),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
      });
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
    return (await this.healthCheck()).state;
  }

  /** Igual a health(), mas preserva o motivo seguro (sem tokens) para o diagnóstico técnico. */
  async healthCheck(): Promise<{ state: "online" | "offline" | "not_configured"; failure?: MelhorEnvioFailureDetails }> {
    try { await this.request("/api/v2/me/shipment/services", {}, true); return { state: "online" }; }
    catch (error) {
      if (!(error instanceof MelhorEnvioError)) return { state: "offline" };
      const { reason, upstreamStatus } = error.diagnostic;
      return { state: error.code === "authentication" ? "not_configured" : "offline",
        failure: { ...(reason ? { reason } : {}), ...(upstreamStatus ? { upstreamStatus } : {}) } };
    }
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
const keyBytes = (encoded: string) => {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(encoded.trim()); }
  catch { throw new MelhorEnvioError("configuration", 503, false); }
  if (bytes.byteLength !== 32) throw new MelhorEnvioError("configuration", 503, false);
  return bytes;
};

/**
 * Chaves mestras do cofre de tokens. `activeKey` cifra toda gravação nova; `previousKeys` só
 * decifram registros antigos durante uma migração controlada. Todas vêm de secrets do Worker.
 */
export type MelhorEnvioTokenKeyring = { activeKey: string; previousKeys?: readonly string[] };
/** Campo autenticado (AAD) no formato v2: impede trocar o ciphertext do access pelo do refresh. */
export type MelhorEnvioTokenField = "access_token" | "refresh_token";

type ImportedTokenKey = { id: string; key: CryptoKey };
type LoadedKeyring = { active: ImportedTokenKey; previous: ImportedTokenKey[] };

const tokenFailure = (reason: "token_decryption_failed" | "token_key_unavailable") =>
  new MelhorEnvioError("authentication", 503, false, { reason });

/**
 * Identificador público e não reversível da chave (12 hex de SHA-256 com separação de domínio).
 * Permite saber qual chave cifrou um registro sem guardar nem exibir a chave.
 */
export async function melhorEnvioTokenKeyId(encodedKey: string): Promise<string> {
  const prefix = new TextEncoder().encode("curtiz:melhorenvio:token-key:v2:");
  const bytes = keyBytes(encodedKey);
  const input = new Uint8Array(prefix.byteLength + bytes.byteLength);
  input.set(prefix);
  input.set(bytes, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(input)));
  return [...digest.slice(0, 6)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const importTokenKey = async (encoded: string): Promise<ImportedTokenKey> => ({
  id: await melhorEnvioTokenKeyId(encoded),
  key: await crypto.subtle.importKey("raw", asArrayBuffer(keyBytes(encoded)), "AES-GCM", false, ["encrypt", "decrypt"])
});

const normalizeKeyring = (keyring: string | MelhorEnvioTokenKeyring): MelhorEnvioTokenKeyring =>
  typeof keyring === "string" ? { activeKey: keyring } : keyring;

async function loadKeyring(input: string | MelhorEnvioTokenKeyring): Promise<LoadedKeyring> {
  const keyring = normalizeKeyring(input);
  if (!keyring.activeKey?.trim()) throw new MelhorEnvioError("configuration", 503, false);
  const active = await importTokenKey(keyring.activeKey);
  const previous: ImportedTokenKey[] = [];
  for (const encoded of keyring.previousKeys ?? []) {
    if (!encoded.trim()) continue;
    const imported = await importTokenKey(encoded);
    if (imported.id !== active.id && !previous.some((key) => key.id === imported.id)) previous.push(imported);
  }
  return { active, previous };
}

/** Lê a lista de chaves anteriores de um secret (separadas por vírgula, espaço ou quebra de linha). */
export function parseMelhorEnvioPreviousKeys(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/u).map((key) => key.trim()).filter(Boolean);
}

const additionalData = (keyId: string, field: MelhorEnvioTokenField) =>
  asArrayBuffer(new TextEncoder().encode(`curtiz:melhorenvio:v2:${keyId}:${field}`));

async function sealToken(value: string, key: ImportedTokenKey, field: MelhorEnvioTokenField): Promise<string> {
  if (!value) throw new MelhorEnvioError("configuration", 503, false);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(key.id, field) },
    key.key, new TextEncoder().encode(value));
  return `v2.${key.id}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

type OpenedToken = { value: string; keyId: string; format: "v1" | "v2"; current: boolean };

async function openToken(value: string, keyring: LoadedKeyring, field: MelhorEnvioTokenField): Promise<OpenedToken> {
  const parts = value.split(".");
  const decrypt = async (key: ImportedTokenKey, iv: string, ciphertext: string, aad?: ArrayBuffer) => {
    try {
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(iv)),
        ...(aad ? { additionalData: aad } : {}) }, key.key, asArrayBuffer(base64ToBytes(ciphertext)));
      return new TextDecoder().decode(decrypted);
    } catch { return null; }
  };
  if (parts[0] === "v2" && parts.length === 4 && parts[1] && parts[2] && parts[3]) {
    const [, keyId, iv, ciphertext] = parts;
    const key = [keyring.active, ...keyring.previous].find((candidate) => candidate.id === keyId);
    // Registro cifrado por uma chave que não está configurada: não há como recuperar sem ela.
    if (!key) throw tokenFailure("token_key_unavailable");
    const opened = await decrypt(key, iv, ciphertext, additionalData(keyId, field));
    if (opened === null) throw tokenFailure("token_decryption_failed");
    return { value: opened, keyId, format: "v2", current: keyId === keyring.active.id };
  }
  if (parts[0] === "v1" && parts.length === 3 && parts[1] && parts[2]) {
    // v1 não identifica a chave: tenta a ativa e depois as anteriores, sem distinguir chave errada de dado corrompido.
    for (const key of [keyring.active, ...keyring.previous]) {
      const opened = await decrypt(key, parts[1], parts[2]);
      if (opened !== null) return { value: opened, keyId: key.id, format: "v1", current: false };
    }
  }
  throw tokenFailure("token_decryption_failed");
}

export async function encryptMelhorEnvioToken(value: string, keyring: string | MelhorEnvioTokenKeyring,
  field: MelhorEnvioTokenField = "access_token"): Promise<string> {
  return sealToken(value, (await loadKeyring(keyring)).active, field);
}

export async function decryptMelhorEnvioToken(value: string, keyring: string | MelhorEnvioTokenKeyring,
  field: MelhorEnvioTokenField = "access_token"): Promise<string> {
  return (await openToken(value, await loadKeyring(keyring), field)).value;
}

export type MelhorEnvioTokenKeyState = "active" | "previous" | "unavailable" | "invalid";
export type MelhorEnvioCredentialKeyReport = {
  activeKeyId: string;
  previousKeyCount: number;
  accessToken: MelhorEnvioTokenKeyState;
  refreshToken: MelhorEnvioTokenKeyState;
  /** Ambos os tokens decifram com a configuração atual. */
  readable: boolean;
  /** Algum token ainda depende de chave anterior ou do formato v1 e será recifrado na próxima leitura. */
  reencryptionPending: boolean;
};

/** Diagnóstico sem segredos: diz se o registro decifra e com qual classe de chave, nunca os valores. */
export async function inspectMelhorEnvioCredentialKeys(record: Pick<EncryptedMelhorEnvioTokenRecord,
  "accessTokenCiphertext" | "refreshTokenCiphertext">, keyring: MelhorEnvioTokenKeyring): Promise<MelhorEnvioCredentialKeyReport> {
  const loaded = await loadKeyring(keyring);
  const state = async (value: string, field: MelhorEnvioTokenField): Promise<[MelhorEnvioTokenKeyState, boolean]> => {
    try {
      const opened = await openToken(value, loaded, field);
      return [opened.keyId === loaded.active.id ? "active" : "previous", !opened.current];
    } catch (error) {
      const reason = error instanceof MelhorEnvioError ? error.diagnostic.reason : undefined;
      return [reason === "token_key_unavailable" ? "unavailable" : "invalid", false];
    }
  };
  const [accessToken, accessPending] = await state(record.accessTokenCiphertext, "access_token");
  const [refreshToken, refreshPending] = await state(record.refreshTokenCiphertext, "refresh_token");
  const readable = !["unavailable", "invalid"].includes(accessToken) && !["unavailable", "invalid"].includes(refreshToken);
  return { activeKeyId: loaded.active.id, previousKeyCount: loaded.previous.length, accessToken, refreshToken,
    readable, reencryptionPending: readable && (accessPending || refreshPending) };
}
