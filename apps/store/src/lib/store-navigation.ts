import "server-only";

import { createPublicSupabaseClient } from "./supabase/server";
import {
  fallbackStoreNavigation,
  serializeStoreNavigation,
  type StoreNavigationItem
} from "./store-navigation-core";

export type { StoreNavigationItem } from "./store-navigation-core";

export async function getStoreNavigation(): Promise<StoreNavigationItem[]> {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return fallbackStoreNavigation;
  const result = await supabase.rpc("get_public_store_navigation");
  if (result.error) return fallbackStoreNavigation;
  const navigation = serializeStoreNavigation(result.data);
  return navigation.length ? navigation : fallbackStoreNavigation;
}
