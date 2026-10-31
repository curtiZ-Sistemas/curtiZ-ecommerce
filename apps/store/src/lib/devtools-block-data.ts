import { logServerEvent } from "@curtiz/security";
import "server-only";

import { unstable_cache } from "next/cache";
import { createPublicSupabaseClient } from "./supabase/server";

const loadDevtoolsBlockEnabled = unstable_cache(
  async (): Promise<boolean> => {
    const supabase = createPublicSupabaseClient();
    if (!supabase) return false;

    const result = await supabase.rpc("is_devtools_block_enabled");
    if (result.error) throw result.error;
    return result.data === true;
  },
  ["store-devtools-block-v1"],
  { revalidate: 60 }
);

export async function getDevtoolsBlockEnabled(): Promise<boolean> {
  try {
    return await loadDevtoolsBlockEnabled();
  } catch (error) {
    logServerEvent("error", "devtools_block_flag_unavailable", { error });
    return false;
  }
}
