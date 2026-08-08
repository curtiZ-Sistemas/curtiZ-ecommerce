import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608080007_professional_homepage_builder.sql", "utf8");
const panel = readFileSync("apps/panel/src/components/homepage-builder.tsx", "utf8");
const storefront = readFileSync("apps/store/src/lib/storefront-data.ts", "utf8");
const renderer = readFileSync("apps/store/src/components/homepage-section-renderer.tsx", "utf8");

const types = [
  "banner_hero", "product_carousel", "product_grid", "product_horizontal", "categories_grid",
  "models_grid", "brands_strip", "collections_grid", "image_links", "image_mosaic",
  "promotions", "flash_offers", "best_sellers", "launches", "featured_products",
  "recommended_products", "manual_products", "campaigns", "benefits", "reviews_carousel",
  "editorial", "video", "image_text", "countdown", "newsletter", "institutional",
  "quick_links", "safe_component"
];

describe("professional homepage builder invariants", () => {
  it("implements every safe section type in schema, editor and storefront", () => {
    expect(types).toHaveLength(28);
    for (const type of types) {
      expect(migration).toContain(`'${type}'`);
      expect(panel).toContain(`["${type}"`);
      expect(storefront).toContain(`"${type}"`);
    }
    expect(renderer).toContain("productTypes");
    expect(renderer).toContain("taxonomyTypes");
    expect(renderer).toContain("imageTypes");
  });

  it("separates editing, review, publication and technical observation", () => {
    for (const permission of ["homepage.create", "homepage.edit", "homepage.review", "homepage.publish", "homepage.lock", "homepage.media.manage", "homepage.metrics.read", "homepage.audit.read", "homepage.technical.observe"]) {
      expect(migration).toContain(`'${permission}'`);
    }
    expect(migration).toContain("('technical','homepage.technical.observe')");
    expect(migration).not.toContain("('technical','homepage.edit')");
    expect(migration).not.toContain("('operational','homepage.publish')");
    expect(migration).toContain("author cannot review own homepage section");
  });

  it("keeps drafts private and publishes one immutable page manifest atomically", () => {
    expect(migration).toContain('drop policy if exists "public reads active homepage sections"');
    expect(migration).toContain("create or replace view public.published_homepage_sections");
    expect(migration).toContain("version.snapshot-'internalName'");
    expect(migration).toContain("perform pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("create or replace function public.publish_homepage");
    expect(migration).toContain("homepage version snapshots are immutable");
    expect(storefront).toContain('.from("published_homepage_sections")');
    expect(storefront).not.toContain('.from("homepage_sections")');
  });

  it("handles an empty homepage while migrating the published manifest", () => {
    expect(migration).toContain(
      "coalesce(jsonb_agg(jsonb_build_object('sectionId',section.id,'versionId',section.current_version_id,'position',section.sort_order) order by section.sort_order),'[]'::jsonb)"
    );
  });

  it("validates targets, products, media, accessibility and arbitrary content", () => {
    expect(migration).toContain("unsafe homepage configuration");
    expect(migration).toContain("external homepage host is not authorized");
    expect(migration).toContain("homepage product target is unavailable");
    expect(migration).toContain("alternative text is required");
    expect(migration).toContain("homepage media limit exceeded");
    expect(migration).toContain("allowed_mime_types");
    expect(migration).toContain("owner_id=auth.uid()");
  });

  it("uses RLS, fixed search paths, restricted grants and aggregate metrics", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toMatch(/security definer set search_path=''/u);
    expect(migration).toContain("revoke insert,update,delete,truncate");
    expect(migration).toContain("record_homepage_metric");
    expect(migration).not.toContain("ip_address");
    expect(migration).not.toContain("user_agent");
  });

  it("provides drag ordering and keyboard-accessible alternatives", () => {
    expect(panel).toContain("draggable=");
    expect(panel).toContain("onDrop=");
    expect(panel).toContain('aria-label="Subir"');
    expect(panel).toContain('aria-label="Descer"');
    expect(panel).toContain('aria-label="Enviar ao topo"');
    expect(panel).toContain('aria-label="Enviar ao final"');
  });
});
