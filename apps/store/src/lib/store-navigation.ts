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
  const result = await supabase
    .from("store_navigation_items")
    .select("id,label,placement,destination_type,destination_value,sort_order")
    .eq("visible", true)
    .order("placement")
    .order("sort_order")
    .order("created_at");
  if (result.error) return fallbackStoreNavigation;
  const navigation = serializeStoreNavigation(result.data);
  return navigation.length ? navigation : fallbackStoreNavigation;
}
