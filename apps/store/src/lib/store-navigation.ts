import "server-only";
import { unstable_cache } from "next/cache";

import { cachePublicStorefrontData } from "./public-storefront-cache";
import { createPublicSupabaseClient } from "./supabase/server";
import {
  fallbackStoreNavigation,
  serializeStoreNavigation,
  type StoreNavigationItem
} from "./store-navigation-core";

export type { StoreNavigationItem } from "./store-navigation-core";

const loadStoreNavigation = unstable_cache(async (): Promise<StoreNavigationItem[]> => {
  const supabase = createPublicSupabaseClient();
  if (!supabase) return fallbackStoreNavigation;
  const result = await supabase.rpc("get_public_store_navigation");
  if (result.error) throw result.error;
  const navigation = serializeStoreNavigation(result.data);
  return navigation.length ? navigation : fallbackStoreNavigation;
}, ["public-store-navigation-v1"], { revalidate: 60 });

export async function getStoreNavigation(): Promise<StoreNavigationItem[]> {
  try {
    return await cachePublicStorefrontData({
      key: "navigation-v1",
      ttlSeconds: 60,
      load: loadStoreNavigation
    });
  } catch {
    return fallbackStoreNavigation;
  }
}
