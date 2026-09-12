import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609120001_public_banner_select_grant.sql",
  "utf8"
).toLowerCase();

describe("permissão pública de leitura dos banners", () => {
  it("concede somente select aos papéis públicos da loja", () => {
    expect(migration).toContain("grant select on table public.banners to anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)/u);
  });
});
