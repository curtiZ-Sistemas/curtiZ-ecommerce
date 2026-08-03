import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase", "migrations", "202608030001_catalog_search.sql"),
  "utf8"
).toLowerCase();

describe("catalog search migration", () => {
  it("fixa search_path e limita execução pública", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.search_catalog");
    expect(sql).toContain("grant execute on function public.search_catalog");
  });

  it("possui paginação e filtros executados no banco", () => {
    expect(sql).toContain("limit greatest(1, least(p_page_size, 48))");
    expect(sql).toContain("p_price_min");
    expect(sql).toContain("p_colors");
    expect(sql).toContain("p_sizes");
    expect(sql).toContain("p_in_stock");
    expect(sql).toContain("p_promotion");
    expect(sql).toContain("compare_at_price_cents");
  });
});
