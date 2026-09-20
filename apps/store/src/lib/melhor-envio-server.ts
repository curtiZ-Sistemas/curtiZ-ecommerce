import "server-only";

import {
  createEncryptedMelhorEnvioTokenStore,
  MelhorEnvioError,
  MelhorEnvioProvider,
  type EncryptedMelhorEnvioTokenRecord,
  type MelhorEnvioEnvironment,
  type MelhorEnvioQuoteProduct
} from "@curtiz/integrations";
import { createHash } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";

type CheckoutLine = { productId: string; variantId: string; quantity: number };
export type MelhorEnvioRuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type ServiceDatabase = NonNullable<ReturnType<typeof createServiceSupabaseClient>>;

const environment = (values: MelhorEnvioRuntimeEnvironment = process.env): MelhorEnvioEnvironment =>
  values.MELHOR_ENVIO_ENVIRONMENT === "production" ? "production" : "sandbox";

export function createMelhorEnvioProvider(values: MelhorEnvioRuntimeEnvironment, db: ServiceDatabase) {
  const encryptionKey = values.MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  if (!encryptionKey) throw new MelhorEnvioError("configuration", 503, false);
  const tokenStore = createEncryptedMelhorEnvioTokenStore({
    encryptionKey,
    async load() {
      const result = readQueryResult(await db.rpc("read_integration_credential", {
        p_provider: "melhorenvio", p_environment: environment(values)
      }));
      if (result.error || !isUnknownRecord(result.data) || readString(result.data, "status") === "disconnected") return null;
      return {
        accessTokenCiphertext: readString(result.data, "access_token_ciphertext"),
        refreshTokenCiphertext: readString(result.data, "refresh_token_ciphertext"),
        accessTokenExpiresAt: readString(result.data, "access_token_expires_at"),
        refreshTokenExpiresAt: readString(result.data, "refresh_token_expires_at") || null
      } satisfies EncryptedMelhorEnvioTokenRecord;
    },
    async save(record) {
      const result = readQueryResult(await db.rpc("save_integration_credential", {
        p_provider: "melhorenvio", p_environment: environment(values),
        p_access_token_ciphertext: record.accessTokenCiphertext,
        p_refresh_token_ciphertext: record.refreshTokenCiphertext,
        p_access_token_expires_at: record.accessTokenExpiresAt,
        p_refresh_token_expires_at: record.refreshTokenExpiresAt
      }));
      if (result.error) throw new MelhorEnvioError("provider_unavailable", 503, true);
    },
    async claimRefreshLock(lockId) {
      const result = readQueryResult(await db.rpc("claim_integration_refresh", {
        p_provider: "melhorenvio", p_environment: environment(values), p_lock_id: lockId
      }));
      return result.error === null && result.data === true;
    },
    async releaseRefreshLock(lockId) {
      await db.rpc("release_integration_refresh", {
        p_provider: "melhorenvio", p_environment: environment(values), p_lock_id: lockId
      });
    }
  });
  return new MelhorEnvioProvider({
    environment: environment(values),
    clientId: values.MELHOR_ENVIO_CLIENT_ID?.trim() ?? "",
    clientSecret: values.MELHOR_ENVIO_CLIENT_SECRET?.trim() ?? "",
    redirectUri: values.MELHOR_ENVIO_REDIRECT_URI?.trim() ?? "",
    applicationName: values.MELHOR_ENVIO_APP_NAME?.trim() ?? "curti Z",
    technicalContact: values.MELHOR_ENVIO_TECHNICAL_CONTACT?.trim() ?? "",
    legacyBaseUrl: values.MELHOR_ENVIO_BASE_URL?.trim()
  }, tokenStore);
}

export function configuredMelhorEnvioProvider() {
  const db = createServiceSupabaseClient();
  if (!db) throw new MelhorEnvioError("configuration", 503, false);
  return createMelhorEnvioProvider(process.env, db);
}

export async function resolveShippingProducts(lines: CheckoutLine[]): Promise<{
  products: MelhorEnvioQuoteProduct[];
  fingerprint: string;
}> {
  const db = createServiceSupabaseClient();
  if (!db) throw new MelhorEnvioError("configuration", 503, false);
  const ids = [...new Set(lines.map((line) => line.variantId))];
  if (ids.length !== lines.length) throw new MelhorEnvioError("validation", 400, false);
  const result = readQueryResult(await db.from("product_variants")
    .select("id,product_id,price_override,active,products!inner(id,status,base_price,weight_grams,height_cm,width_cm,length_cm)")
    .in("id", ids));
  if (result.error || !Array.isArray(result.data)) throw new MelhorEnvioError("provider_unavailable", 503, true);
  const rows = result.data.filter(isUnknownRecord);
  const products = lines.map((line) => {
    const variant = rows.find((row) => readString(row, "id") === line.variantId);
    const productValue = variant?.products;
    const product = Array.isArray(productValue) ? productValue.find(isUnknownRecord) : isUnknownRecord(productValue) ? productValue : null;
    const weightGrams = product ? readNumber(product, "weight_grams") : Number.NaN;
    const price = variant && readNumber(variant, "price_override") > 0
      ? readNumber(variant, "price_override") : product ? readNumber(product, "base_price") : Number.NaN;
    const widthCm = product ? readNumber(product, "width_cm") : Number.NaN;
    const heightCm = product ? readNumber(product, "height_cm") : Number.NaN;
    const lengthCm = product ? readNumber(product, "length_cm") : Number.NaN;
    if (!variant || !product || variant.active !== true || readString(product, "status") !== "active"
      || readString(variant, "product_id") !== line.productId || !Number.isInteger(line.quantity) || line.quantity <= 0
      || [weightGrams, price, widthCm, heightCm, lengthCm].some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new MelhorEnvioError("validation", 409, false);
    }
    return { id: line.variantId, quantity: line.quantity, weightKg: weightGrams / 1000,
      widthCm, heightCm, lengthCm, insuranceValue: price };
  });
  const canonical = products.map((product) => ({ ...product })).sort((a, b) => a.id.localeCompare(b.id));
  return { products, fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
