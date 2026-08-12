import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608100001_initial_editable_catalog.sql"),
  "utf8"
);
const seed = readFileSync(resolve(process.cwd(), "supabase/seed.sql"), "utf8");

const productSlugs = [
  "flip-flop-wave-preto",
  "flip-flop-slim-coral",
  "slide-bold-marinho",
  "sandalia-comfort-areia",
  "infantil-joy-rosa",
  "slide-soft-preto",
  "flip-flop-classic-preto",
  "slide-comfort-bege"
];

describe("initial editable catalog migration", () => {
  it("materializes all eight storefront products with editable relations", () => {
    for (const slug of productSlugs) expect(migration).toContain(`'${slug}'`);
    expect(migration).toContain("insert into public.product_variants");
    expect(migration).toContain("insert into public.inventory");
    expect(migration).toContain("on conflict (variant_id) do update");
    expect(migration).toContain("insert into public.product_images");
  });

  it("publishes the real hero without bypassing the existing banner workflow", () => {
    expect(migration).toContain("insert into public.banners");
    expect(migration).toContain("'/images/hero-curtiz-desktop.png'");
    expect(migration).toContain("'/images/hero-curtiz-mobile.png'");
    expect(migration).toContain("where not exists (");
    expect(migration).not.toContain("disable row level security");
  });

  it("keeps deterministic test variants distinct from catalog migration combinations", () => {
    expect(seed).toContain("'CZT-FW-PRE-40', 'Preto', '#171717', '40', true");
    expect(seed).toContain("'CZT-FS-COR-38', 'Coral', '#CF6853', '38', true");
    expect(seed).not.toContain("'CZT-FW-PRE-40', 'Preto', '#171717', '39/40', true");
    expect(seed).not.toContain("'CZT-FS-COR-38', 'Coral', '#CF6853', '37/38', true");
  });
});
