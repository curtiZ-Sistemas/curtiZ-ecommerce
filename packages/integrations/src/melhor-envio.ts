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

export function createEncryptedMelhorEnvioTokenStore(input: {
  encryptionKey: string;
  load: () => Promise<EncryptedMelhorEnvioTokenRecord | null>;
  save: (record: EncryptedMelhorEnvioTokenRecord) => Promise<void>;
  claimRefreshLock: (lockId: string) => Promise<boolean>;
  releaseRefreshLock: (lockId: string) => Promise<void>;
}): MelhorEnvioTokenStore {
  return {
    async read() {
      const record = await input.load();
      if (!record) return null;
      return {
        accessToken: await decryptMelhorEnvioToken(record.accessTokenCiphertext, input.encryptionKey),
        refreshToken: await decryptMelhorEnvioToken(record.refreshTokenCiphertext, input.encryptionKey),
        accessTokenExpiresAt: record.accessTokenExpiresAt,
        refreshTokenExpiresAt: record.refreshTokenExpiresAt
      };
    },
    async write(tokens) {
      await input.save({
        accessTokenCiphertext: await encryptMelhorEnvioToken(tokens.accessToken, input.encryptionKey),
        refreshTokenCiphertext: await encryptMelhorEnvioToken(tokens.refreshToken, input.encryptionKey),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
      });
    },
    async withRefreshLock(operation) {
      const lockId = crypto.randomUUID();
      const deadline = Date.now() + 10_000;
      while (!(await input.claimRefreshLock(lockId))) {
        if (Date.now() >= deadline) throw new MelhorEnvioError("provider_unavailable", 503, true);
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

export class MelhorEnvioError extends Error {
  constructor(
    readonly code: "configuration" | "authentication" | "not_found" | "conflict" | "validation" |
      "rate_limited" | "provider_unavailable" | "network" | "timeout" | "invalid_response" |
      "uncertain_write",
    readonly httpStatus: number,
    readonly retryable: boolean
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
    if (!response.ok) throw providerError(response.status, true);
    return result;
  }

  private get userAgent() { return `${this.config.applicationName} (${this.config.technicalContact})`; }

  private async accessToken(forceRefresh = false): Promise<string> {
    const current = await this.tokens.read();
    if (!current) throw new MelhorEnvioError("authentication", 503, false);
    if (!forceRefresh && Date.parse(current.accessTokenExpiresAt) > Date.now() + 60_000) return current.accessToken;
    return this.tokens.withRefreshLock(async () => {
      const latest = await this.tokens.read();
      if (!latest) throw new MelhorEnvioError("authentication", 503, false);
      const anotherRequestRefreshed = forceRefresh && latest.accessToken !== current.accessToken;
      if ((!forceRefresh || anotherRequestRefreshed) && Date.parse(latest.accessTokenExpiresAt) > Date.now() + 60_000) {
        return latest.accessToken;
      }
      if (latest.refreshTokenExpiresAt && Date.parse(latest.refreshTokenExpiresAt) <= Date.now()) {
        throw new MelhorEnvioError("authentication", 401, false);
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
      await this.accessToken(true);
      return this.request(path, init, safeToRetry, true);
    }
    if (!response.ok) throw providerError(response.status, safeToRetry);
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
    return result.flatMap((entry): MelhorEnvioQuote[] => {
      const row = asObject(entry);
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
        || !Number.isFinite(cost) || cost < 0 || !Number.isInteger(days) || days <= 0 || packages.length === 0
        || row?.error) return [];
      return [{ provider: "melhorenvio", serviceId, service, carrier,
        amountInCents: Math.round(charged * 100), costInCents: Math.round(cost * 100),
        estimatedDays: days, packages, expiresAt }];
    });
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
const encryptionKey = async (encoded: string) => {
  let bytes: Uint8Array;
  try { bytes = base64ToBytes(encoded.trim()); }
  catch { throw new MelhorEnvioError("configuration", 503, false); }
  if (bytes.byteLength !== 32) throw new MelhorEnvioError("configuration", 503, false);
  return crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
};

export async function encryptMelhorEnvioToken(value: string, encodedKey: string): Promise<string> {
  if (!value) throw new MelhorEnvioError("configuration", 503, false);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(encodedKey), new TextEncoder().encode(value));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptMelhorEnvioToken(value: string, encodedKey: string): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new MelhorEnvioError("configuration", 503, false);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(iv)) },
      await encryptionKey(encodedKey), asArrayBuffer(base64ToBytes(ciphertext)));
    return new TextDecoder().decode(decrypted);
  } catch { throw new MelhorEnvioError("authentication", 503, false); }
}
