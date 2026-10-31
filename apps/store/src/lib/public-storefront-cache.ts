import { logServerEvent } from "@curtiz/security";
import "server-only";

type StorefrontCache = {
  match: (request: Request) => Promise<Response | null | undefined>;
  put: (request: Request, response: Response) => Promise<unknown>;
};

type PublicStorefrontCacheOptions<T> = {
  key: string;
  ttlSeconds: 30 | 60;
  load: () => Promise<T>;
  cache?: StorefrontCache;
};

const cacheOrigin = "https://curtiz.com.br";

function runtimeCache(): StorefrontCache | undefined {
  if (process.env.NODE_ENV !== "production" || typeof globalThis.caches === "undefined") return undefined;
  const workerCaches = globalThis.caches as CacheStorage & { default?: Cache };
  return workerCaches.default;
}

function cacheKey(key: string): Request {
  const configuredEnvironment = process.env.APP_ENV?.trim().toLowerCase();
  const environment = configuredEnvironment && /^[a-z0-9_-]{1,40}$/u.test(configuredEnvironment)
    ? configuredEnvironment
    : process.env.NODE_ENV === "production" ? "production" : "development";
  return new Request(`${cacheOrigin}/__curtiz_public_data_cache/${environment}/${key}`);
}

export async function cachePublicStorefrontData<T>({
  key,
  ttlSeconds,
  load,
  cache = runtimeCache()
}: PublicStorefrontCacheOptions<T>): Promise<T> {
  if (!cache) return load();

  const request = cacheKey(key);
  try {
    const cached = await cache.match(request);
    if (cached?.ok) {
      try {
        return await cached.json() as T;
      } catch {
        logServerEvent("warn", "storefront_public_cache_invalid_entry", { key });
      }
    }
  } catch (error) {
    logServerEvent("warn", "storefront_public_cache_read_failed", {
      key,
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  const value = await load();
  try {
    const response = Response.json(value, {
      headers: { "Cache-Control": `public, max-age=${ttlSeconds}` }
    });
    await cache.put(request, response);
  } catch (error) {
    logServerEvent("warn", "storefront_public_cache_write_failed", {
      key,
      error: error instanceof Error ? error.message : "unknown"
    });
  }
  return value;
}
