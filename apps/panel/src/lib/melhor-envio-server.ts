import "server-only";

import {
  createEncryptedMelhorEnvioTokenStore,
  MelhorEnvioError,
  MelhorEnvioProvider,
  type EncryptedMelhorEnvioTokenRecord,
  type MelhorEnvioEnvironment
} from "@curtiz/integrations";
import { getMelhorEnvioReadiness, type IntegrationEnvironment } from "@curtiz/config";
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

export function melhorEnvioOriginMissingFields(environment: IntegrationEnvironment = process.env): string[] {
  const readiness = getMelhorEnvioReadiness(environment);
  return [...readiness.missing, ...readiness.invalid]
    .filter((name) => name.startsWith("MELHOR_ENVIO_ORIGIN_"));
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
