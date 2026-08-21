import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608200001_homepage_social_proof_and_best_sellers.sql",
  "utf8"
);
const storefront = readFileSync("apps/store/src/lib/storefront-data.ts", "utf8");
const renderer = readFileSync("apps/store/src/components/homepage-section-renderer.tsx", "utf8");
const panel = readFileSync("apps/panel/src/components/homepage-builder.tsx", "utf8");
const panelApi = readFileSync("apps/panel/src/app/api/homepage-builder/route.ts", "utf8");

describe("homepage social proof and best sellers", () => {
  it("counts only qualified paid sales and removes reversed orders", () => {
    expect(migration).toContain("sale.payment_status = 'approved'");
    for (const status of ["cancelled", "returned", "refund_pending", "refunded"]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("sum(item.quantity)");
    expect(migration).toContain("sale.placed_at");
  });

  it("supports period, ranking criterion and deterministic eligible fallback", () => {
    expect(migration).toContain("'30d', '90d', 'all'");
    expect(migration).toContain("'units', 'revenue'");
    expect(migration).toContain(":curtiz-home-fallback");
    expect(migration).toContain("product.status = 'active'");
    expect(migration).toContain("variant.active");
    expect(migration).toContain("product_image.storage_path");
    expect(storefront).toContain('rpc("get_homepage_best_sellers"');
  });

  it("never derives a verified badge from a manual testimonial", () => {
    expect(renderer).toContain("verified: false");
    expect(renderer).toContain("review.verified");
    expect(panel).toContain("Manual (sem selo verificado)");
    expect(panelApi).toContain('.eq("status", "approved")');
  });

  it("keeps all three sections configurable in the existing builder", () => {
    for (const setting of ["desktopEnabled", "mobileEnabled", "autoplayInterval", "desktopCards", "salesPeriod", "rankingMetric", "fillEmptySlots", "excludeOutOfStock"]) {
      expect(panel).toContain(setting);
    }
    expect(panel).toContain("value.sectionType === \"benefits\" ? 4");
  });
});
