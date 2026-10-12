import "server-only";

import {
  createEncryptedMelhorEnvioTokenStore,
  MelhorEnvioError,
  MelhorEnvioProvider,
  parseMelhorEnvioPreviousKeys,
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
  process.env.MELHOR_ENVIO_ENVIRONMENT?.trim().toLowerCase() === "production" ? "production" : "sandbox";

/** Somente nomes de campos ausentes/inválidos do Worker do painel; nunca valores. */
export function melhorEnvioConfigurationIssues(environment: IntegrationEnvironment = process.env): string {
  const readiness = getMelhorEnvioReadiness(environment);
  return [...readiness.missing.map((name) => `ausente: ${name}`), ...readiness.invalid.map((name) => `inválido: ${name}`)]
    .join(", ");
}

export function melhorEnvioOriginMissingFields(environment: IntegrationEnvironment = process.env): string[] {
  const readiness = getMelhorEnvioReadiness(environment);
  return [...readiness.missing, ...readiness.invalid]
    .filter((name) => name.startsWith("MELHOR_ENVIO_ORIGIN_"));
}

function panelMelhorEnvioTokenStore() {
  const db = createServiceSupabaseClient();
  const encryptionKey = process.env.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!db || !encryptionKey) throw new MelhorEnvioError("configuration", 503, false);
  return createEncryptedMelhorEnvioTokenStore({
    encryptionKey,
    previousEncryptionKeys: parseMelhorEnvioPreviousKeys(process.env.MELHOR_ENVIO_TOKEN_ENCRYPTION_PREVIOUS_KEYS),
    async replaceCiphertexts(expected, next) {
      const replaced = result(await db.rpc("reencrypt_integration_credential", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(),
        p_expected_access_token_ciphertext: expected.accessTokenCiphertext,
        p_expected_refresh_token_ciphertext: expected.refreshTokenCiphertext,
        p_access_token_ciphertext: next.accessTokenCiphertext,
        p_refresh_token_ciphertext: next.refreshTokenCiphertext
      }));
      if (replaced.error || typeof replaced.data !== "boolean") throw new MelhorEnvioError("provider_unavailable", 503, true);
      return replaced.data;
    },
    onKeyRotation(event) {
      console.warn(JSON.stringify({ ...event, worker: "panel" }));
    },
    async load() {
      const query = result(await db.rpc("read_integration_credential", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment()
      }));
      const row = record(query.data);
      if (query.error) throw new MelhorEnvioError("provider_unavailable", 503, true, {
        reason: "credentials_read_failed", databaseCode: text(record(query.error)?.code)
      });
      if (!row || text(row.status) === "disconnected") return null;
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
      if (saved.error) throw new MelhorEnvioError("provider_unavailable", 503, true, {
        reason: "credentials_write_failed", databaseCode: text(record(saved.error)?.code)
      });
    },
    async claimRefreshLock(lockId) {
      const claimed = result(await db.rpc("claim_integration_refresh", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(), p_lock_id: lockId
      }));
      if (claimed.error || typeof claimed.data !== "boolean") throw new MelhorEnvioError("provider_unavailable", 503, true, { reason: "refresh_lock_failed" });
      return claimed.data;
    },
    async releaseRefreshLock(lockId) {
      await db.rpc("release_integration_refresh", {
        p_provider: "melhorenvio", p_environment: melhorEnvioEnvironment(), p_lock_id: lockId
      });
    }
  });
}

/**
 * Diagnóstico sem decifrar para fora do processo: informa somente estado e impressões digitais
 * públicas das chaves (ativa e do registro). Não altera nem remove o ciphertext.
 */
export function inspectPanelMelhorEnvioCredential() {
  return panelMelhorEnvioTokenStore().inspect();
}

export function panelMelhorEnvioProvider() {
  const tokenStore = panelMelhorEnvioTokenStore();
  return new MelhorEnvioProvider({
    environment: melhorEnvioEnvironment(), clientId: process.env.MELHOR_ENVIO_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.MELHOR_ENVIO_REDIRECT_URI?.trim() ?? "",
    applicationName: process.env.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
    technicalContact: process.env.MELHOR_ENVIO_TECHNICAL_CONTACT?.trim() ?? "",
    legacyBaseUrl: process.env.MELHOR_ENVIO_BASE_URL?.trim()
  }, tokenStore);
}
