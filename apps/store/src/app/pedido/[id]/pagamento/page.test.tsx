import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
vi.mock("server-only", () => ({}));
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
  it.each(["cancellation_requested", "cancelled", "expired", "payment_approved", "processing", "preparing", "shipped", "delivered", "refunded"])("does not offer a new payment session for %s", async (status) => {
    const query = (table: string) => {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: table === "orders"
        ? { status, public_code: "ORDER" }
        : { status: "pending", payment_method_summary: "pix", status_detail: "expired" } }) };
      return builder;
    };
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "customer" } } }) }, from: query
    } as never);
    const page = await Page({ params: Promise.resolve({ id: "order" }) });
    expect(page.props).toEqual({ orderId: "order", session: null });
  });

  it("rejects a missing or foreign order and queries the current owner", async () => {
    const filters = vi.fn();
    const builder = { select: () => builder, eq: (key: string, value: string) => {
      filters(key, value); return builder;
    }, maybeSingle: async () => ({ data: null, error: null }) };
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "customer" } } }) }, from: () => builder
    } as never);
    await expect(Page({ params: Promise.resolve({ id: "foreign-order" }) })).rejects.toThrow("not-found");
    expect(filters).toHaveBeenCalledWith("customer_id", "customer");
  });
});
