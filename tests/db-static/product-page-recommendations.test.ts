import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("apps/store/src/app/produto/[slug]/page.tsx", "utf8");
const purchase = readFileSync("apps/store/src/components/product-purchase.tsx", "utf8");
const shelf = readFileSync("apps/store/src/components/intelligence-shelf.tsx", "utf8");
const styles = readFileSync("apps/store/src/app/globals.css", "utf8");
const migration = readFileSync(
  "supabase/migrations/202608230004_product_recommendation_purchase_filter.sql",
  "utf8"
);

describe("product page recommendations", () => {
  it("reuses the intelligence engine and excludes the product being viewed", () => {
    expect(page).toContain("<IntelligenceShelf");
    expect(page).toContain('source="personalized"');
    expect(page).toContain("excludeProductIds={[product.id]}");
    expect(shelf).toContain("recentlyViewedProductIds");
    expect(page).not.toContain("queryPublicCatalog");
  });

  it("removes generic commerce notes and the selected-color dot", () => {
    expect(purchase).not.toContain("product-commerce-notes");
    expect(purchase).not.toContain("Vendido por");
    expect(styles).not.toContain(".color-swatch.selected::after");
  });

  it("uses a wrapping four, three and two-column recommendation grid", () => {
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("excludes purchases only when their server-side order is valid and approved", () => {
    expect(migration).toContain("purchased_order.customer_id=auth.uid()");
    expect(migration).toContain("purchased_order.payment_status='approved'");
    expect(migration).toContain(
      "purchased_order.status not in ('cancelled','returned','refund_pending','refunded')"
    );
    expect(migration).toContain("purchased_item.product_id=product.id");
  });

  it("balances individual affinity, current-product context and popularity", () => {
    expect(migration).toContain("affinity*100+context_affinity*25");
    expect(migration).toContain("p_source='personalized'");
    expect(migration).toContain("signal_score");
  });
});
