import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  AUTH_PERSISTENCE_COOKIE,
  applyAuthCookiePersistence,
  readAuthPersistence,
  sharedCookieOptions,
  type AuthPersistence
} from "@curtiz/security";
import { cookies, headers } from "next/headers";

const validSupabaseOrigin = (value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname)
      && process.env.APP_ENV !== "production";
    return (url.protocol === "https:" || localHttp) && url.pathname === "/"
      && !url.search && !url.hash && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

export async function createServerSupabaseClient(options?: { persistence?: AuthPersistence }) {
  const url = validSupabaseOrigin(process.env.SUPABASE_URL);
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const persistence =
    options?.persistence ?? readAuthPersistence(cookieStore.get(AUTH_PERSISTENCE_COOKIE)?.value);

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set({
              name,
              value,
              ...sharedCookieOptions(applyAuthCookiePersistence(options, persistence), host)
            });
          } catch {
            // Server Components não podem persistir refresh; o proxy o fará.
          }
        }
      }
    }
  });
}

/** Public, stateless client for RPCs explicitly granted to the anon role. */
export function createPublicSupabaseClient() {
  const url = validSupabaseOrigin(process.env.SUPABASE_URL);
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

/** Server-only client for narrowly scoped public endpoints after their own abuse checks. */
export function createServiceSupabaseClient() {
  const url = validSupabaseOrigin(process.env.SUPABASE_URL);
  // Prefer Supabase's current secret-key name, with compatibility for Workers
  // that still use the legacy service-role variable.
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!url || !secretKey) return null;
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
