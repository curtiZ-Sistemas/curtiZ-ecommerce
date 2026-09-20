import "server-only";

import {
  createEncryptedMelhorEnvioTokenStore,
  MelhorEnvioError,
  MelhorEnvioProvider,
  type EncryptedMelhorEnvioTokenRecord,
  type MelhorEnvioEnvironment
} from "@curtiz/integrations";
import { createServiceSupabaseClient } from "./supabase/server";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as UnknownRecord : null;
const result = (value: unknown) => {
  const row = record(value);
  return { data: row?.data ?? null, error: row?.error ?? null };
};
const text = (value: unknown) => typeof value === "string" ? value : "";
export const melhorEnvioEnvironment = (): MelhorEnvioEnvironment =>
  process.env.MELHOR_ENVIO_ENVIRONMENT === "production" ? "production" : "sandbox";

export function melhorEnvioOriginMissingFields(): string[] {
  const digits = (name: string) => (process.env[name] ?? "").replace(/\D/gu, "");
  const value = (name: string) => process.env[name]?.trim() ?? "";
  const missing = [
    "MELHOR_ENVIO_ORIGIN_NAME", "MELHOR_ENVIO_ORIGIN_EMAIL", "MELHOR_ENVIO_ORIGIN_PHONE",
    "MELHOR_ENVIO_ORIGIN_ADDRESS", "MELHOR_ENVIO_ORIGIN_NUMBER", "MELHOR_ENVIO_ORIGIN_DISTRICT",
    "MELHOR_ENVIO_ORIGIN_CITY", "MELHOR_ENVIO_ORIGIN_STATE", "MELHOR_ENVIO_ORIGIN_POSTAL_CODE"
  ].filter((name) => !value(name));
  if (value("MELHOR_ENVIO_ORIGIN_EMAIL") && !/^\S+@\S+\.\S+$/u.test(value("MELHOR_ENVIO_ORIGIN_EMAIL"))) missing.push("MELHOR_ENVIO_ORIGIN_EMAIL (inválido)");
  if (value("MELHOR_ENVIO_ORIGIN_PHONE") && !/^\d{10,11}$/u.test(digits("MELHOR_ENVIO_ORIGIN_PHONE"))) missing.push("MELHOR_ENVIO_ORIGIN_PHONE (inválido)");
  if (value("MELHOR_ENVIO_ORIGIN_STATE") && !/^[A-Za-z]{2}$/u.test(value("MELHOR_ENVIO_ORIGIN_STATE"))) missing.push("MELHOR_ENVIO_ORIGIN_STATE (inválido)");
  if (value("MELHOR_ENVIO_ORIGIN_POSTAL_CODE") && !/^\d{8}$/u.test(digits("MELHOR_ENVIO_ORIGIN_POSTAL_CODE"))) missing.push("MELHOR_ENVIO_ORIGIN_POSTAL_CODE (inválido)");
  const personalDocument = digits("MELHOR_ENVIO_ORIGIN_DOCUMENT");
  const companyDocument = digits("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
  if (melhorEnvioEnvironment() === "production" && !/^\d{14}$/u.test(companyDocument)) {
    missing.push("MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT (CNPJ obrigatório em produção comercial)");
  } else if (melhorEnvioEnvironment() === "production" && !value("MELHOR_ENVIO_ORIGIN_STATE_REGISTER")) {
    missing.push("MELHOR_ENVIO_ORIGIN_STATE_REGISTER");
  } else if (!/^\d{11}$/u.test(personalDocument) && !/^\d{14}$/u.test(companyDocument)) {
    missing.push("MELHOR_ENVIO_ORIGIN_DOCUMENT ou MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT");
  }
  return [...new Set(missing)];
}

export function panelMelhorEnvioProvider() {
  const db = createServiceSupabaseClient();
  const encryptionKey = process.env.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!db || !encryptionKey) throw new MelhorEnvioError("configuration", 503, false);
  const tokenStore = createEncryptedMelhorEnvioTokenStore({
    encryptionKey,
    async load() {
      const query = result(await db.rpc("read_integration_credential", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment()
      }));
      const row = record(query.data);
      if (query.error || !row || text(row.status) === "disconnected") return null;
      return { accessTokenCiphertext: text(row.access_token_ciphertext),
        refreshTokenCiphertext: text(row.refresh_token_ciphertext), accessTokenExpiresAt: text(row.access_token_expires_at),
        refreshTokenExpiresAt: text(row.refresh_token_expires_at) || null } satisfies EncryptedMelhorEnvioTokenRecord;
    },
    async save(tokens) {
      const saved = result(await db.rpc("save_integration_credential", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(),
        p_access_token_ciphertext: tokens.accessTokenCiphertext,
        p_refresh_token_ciphertext: tokens.refreshTokenCiphertext,
        p_access_token_expires_at: tokens.accessTokenExpiresAt,
        p_refresh_token_expires_at: tokens.refreshTokenExpiresAt
      }));
      if (saved.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
    },
    async claimRefreshLock(lockId) {
      const claimed = result(await db.rpc("claim_integration_refresh", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(), p_lock_id: lockId
      }));
      return !claimed.error && claimed.data === true;
    },
    async releaseRefreshLock(lockId) {
      await db.rpc("release_integration_refresh", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(), p_lock_id: lockId
      });
    }
  });
  return new MelhorEnvioProvider({
    environment: melhorEnvioEnvironment(), clientId: process.env.MELHOR_ENVIO_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.MELHOR_ENVIO_REDIRECT_URI?.trim() ?? "",
    applicationName: process.env.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
    technicalContact: process.env.MELHOR_ENVIO_TECHNICAL_CONTACT?.trim() ?? "",
    legacyBaseUrl: process.env.MELHOR_ENVIO_BASE_URL?.trim()
  }, tokenStore);
}
