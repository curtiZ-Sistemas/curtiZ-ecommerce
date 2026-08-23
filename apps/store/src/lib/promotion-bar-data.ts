import "server-only";

import {
  selectCurrentPromotionBarMessages,
  type PromotionBarMessage
} from "@curtiz/domain";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { createPublicSupabaseClient } from "./supabase/server";

const promotionMessageRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    message_text: z.string().trim().min(4).max(140),
    cta_label: z.string().trim().min(1).max(40).nullable(),
    link_path: z.string().trim().max(500).nullable(),
    sort_order: z.coerce.number().int().min(0).max(999),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable()
  })
);

const loadPromotionBarMessages = unstable_cache(
  async (): Promise<PromotionBarMessage[]> => {
    const supabase = createPublicSupabaseClient();
    if (!supabase) return [];

    const result = await supabase
      .from("current_store_promotion_messages")
      .select("id,message_text,cta_label,link_path,sort_order,starts_at,ends_at")
      .order("sort_order", { ascending: true })
      .limit(3);
    if (result.error) throw result.error;

    const parsed = promotionMessageRowsSchema.safeParse(result.data ?? []);
    if (!parsed.success) throw new Error("Invalid promotion bar data.");

    return parsed.data.map((row) => ({
      id: row.id,
      text: row.message_text,
      active: true,
      sortOrder: row.sort_order,
      ...(row.link_path ? { href: row.link_path } : {}),
      ...(row.cta_label ? { cta: row.cta_label } : {}),
      ...(row.starts_at ? { startsAt: row.starts_at } : {}),
      ...(row.ends_at ? { endsAt: row.ends_at } : {})
    }));
  },
  ["store-promotion-bar-v1"],
  { revalidate: 60 }
);

export async function getPromotionBarMessages(): Promise<PromotionBarMessage[]> {
  try {
    return selectCurrentPromotionBarMessages(await loadPromotionBarMessages());
  } catch (error) {
    console.error(
      "[promotion-bar] Não foi possível carregar as mensagens.",
      error instanceof Error ? error.message : "Erro desconhecido."
    );
    return [];
  }
}
