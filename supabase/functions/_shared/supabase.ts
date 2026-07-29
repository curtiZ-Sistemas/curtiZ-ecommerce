import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./http.ts";

export const serviceClient = () =>
  createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });

export const userClient = (authorization: string) =>
  createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
