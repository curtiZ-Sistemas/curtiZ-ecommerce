import { logServerEvent } from "@curtiz/security";
import "server-only";

import { unstable_cache } from "next/cache";
import { parseCompanyIdentification, type CompanyIdentification } from "./company-identification";
import { createPublicSupabaseClient } from "./supabase/server";

const loadCompanyIdentification = unstable_cache(
  async (): Promise<CompanyIdentification | null> => {
    const supabase = createPublicSupabaseClient();
    if (!supabase) return null;

    const result = await supabase.rpc("public_company_identification");
    if (result.error) throw result.error;
    return parseCompanyIdentification(result.data);
  },
  ["store-company-identification-v1"],
  { revalidate: 300 }
);

export async function getCompanyIdentification(): Promise<CompanyIdentification | null> {
  try {
    return await loadCompanyIdentification();
  } catch (error) {
    logServerEvent("error", "company_identification_unavailable", { error });
    return null;
  }
}
