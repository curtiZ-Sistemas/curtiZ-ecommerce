import { describe, expect, it, vi } from "vitest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Page from "./page";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/components/order-payment", () => ({ OrderPayment: () => null }));
vi.mock("@/lib/customer-account-presentation", () => import("../../../../lib/customer-account-presentation"));
vi.mock("@/lib/unknown-data", () => import("../../../../lib/unknown-data"));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("not-found"); }
}));

describe("direct payment page access", () => {
  it.each(["cancellation_requested", "cancelled", "expired", "payment_approved", "processing", "preparing", "shipped", "delivered", "refunded"])("redirects %s to order history", async (status) => {
    const query = (table: string) => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: table === "orders"
        ? { status, public_code: "ORDER" }
        : { status: "pending", payment_method_summary: "pix", status_detail: "expired" } }) };
      return builder;
    };
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "customer" } } }) }, from: query
    } as never);
    await expect(Page({ params: Promise.resolve({ id: "order" }) })).rejects.toThrow("redirect:/minha-conta/pedidos?pedido=ORDER");
  });
});
