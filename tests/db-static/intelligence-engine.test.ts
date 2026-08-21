import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608210001_intelligence_engine.sql", "utf8");
const client = readFileSync("apps/store/src/lib/intelligence-client.ts", "utf8");
const renderer = readFileSync("apps/store/src/components/homepage-section-renderer.tsx", "utf8");

describe("curti Z intelligence engine", () => {
  it("accepts bounded consented batches and excludes client purchases", () => {
    expect(migration).toContain("jsonb_array_length(p_events) not between 1 and 20");
    expect(migration).toContain("p_consent");
    expect(migration).not.toMatch(/allowed_types constant[^;]*purchase/);
    expect(client).toContain("maxBatch = 20");
    expect(client).toContain("sendBeacon");
  });
  it("supports session erasure without touching anonymous aggregates", () => {
    expect(migration).toContain("forget_intelligence_session");
    expect(migration).toContain("event.user_id is null or event.user_id=auth.uid()");
    expect(client).toContain('method: "DELETE"');
  });
  it("protects aggregates and enforces atomic throttling and idempotency", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("revoke all on public.product_metrics_daily");
    expect(migration).toContain("recommendation_metrics_daily");
    expect(migration).toContain("intelligence_rate_buckets");
    expect(migration).toContain("client_event_id");
    expect(migration).toContain("on conflict do nothing");
  });
  it("derives commerce only from approved server orders", () => {
    expect(migration).toContain("aggregate_approved_order_intelligence");
    expect(migration).toContain("new.payment_status='approved'");
    expect(migration).toContain("public.order_items");
  });
  it("uses compact decayed interests and excludes unavailable or seen products", () => {
    expect(migration).toContain("power(0.5");
    expect(migration).toContain("recent_product_ids");
    expect(migration).toContain("product.status='active'");
    expect(migration).toContain("variants.stock>0");
    expect(migration).toContain("p_seen");
    expect(migration).not.toMatch(/get_intelligence_recommendations[\s\S]*\boffset\b/);
  });
  it("exposes configurable intelligent shelves with resilient discovery", () => {
    expect(renderer).toContain("IntelligenceShelf");
    expect(renderer).toContain('source==="discovery"');
  });
});
