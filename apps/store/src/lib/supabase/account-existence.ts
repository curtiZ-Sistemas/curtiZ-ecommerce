import "server-only";

import { createClient } from "@supabase/supabase-js";

export type AccountExistence = "exists" | "missing" | "unavailable";

export async function findAccountByEmail(email: string): Promise<AccountExistence> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return "unavailable";

  const client = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  try {
    const result = await client
      .from("profiles")
      .select("id")
      .eq("email_snapshot", email)
      .limit(1)
      .maybeSingle();

    if (result.error) return "unavailable";
    return result.data ? "exists" : "missing";
  } catch {
    return "unavailable";
  }
}
