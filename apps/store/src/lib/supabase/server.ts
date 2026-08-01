import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sharedCookieOptions } from "@curtiz/security";
import { cookies, headers } from "next/headers";

export async function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return null;

  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>
      ) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set({ name, value, ...sharedCookieOptions(options, host) });
          } catch {
            // Server Components não podem persistir refresh; o proxy o fará.
          }
        }
      }
    }
  });
}
