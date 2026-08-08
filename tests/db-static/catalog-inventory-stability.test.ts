import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const reserveSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202607290004_functions_rls_storage.sql"),
  "utf8"
).toLowerCase();
const stabilitySql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080008_catalog_inventory_stability.sql"),
  "utf8"
).toLowerCase();

describe("catalog and inventory stability migration", () => {
  it("não desconta reservas duas vezes nos leitores de estoque", () => {
    expect(reserveSql).toContain("available_quantity = available_quantity - p_quantity");
    expect(reserveSql).toContain("reserved_quantity = reserved_quantity + p_quantity");
    expect(stabilitySql).toContain("greatest(stock.available_quantity, 0)");
    expect(stabilitySql).toContain("greatest(inventory.available_quantity, 0)");
    expect(stabilitySql).toContain("stock.available_quantity > 0");
  });

  it("ordena a agregação da página com desempate por id", () => {
    expect(stabilitySql).toContain("case when p_sort = ''price_asc'' then price_cents end asc");
    expect(stabilitySql).toContain("featured desc, sold_count desc, created_at desc, id");
    expect(stabilitySql).toContain("pg_catalog.regexp_replace");
    expect(stabilitySql).not.toContain("pg_catalog.strpos");
    expect(stabilitySql).toContain(
      "if corrected_definition <> function_definition then execute corrected_definition; end if;"
    );
  });

  it("concede somente operações necessárias para a RLS de atendimento", () => {
    expect(stabilitySql).toContain(
      "grant select, insert, update on public.support_conversations to authenticated"
    );
    expect(stabilitySql).not.toContain("grant all");
    expect(stabilitySql).not.toContain("to anon");
  });
});
