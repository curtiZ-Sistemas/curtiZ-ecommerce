import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608160002_help_center_brand_hardening.sql"),
  "utf8"
);

describe("help center brand hardening migration", () => {
  it("adiciona Compras e corrige somente a marca visível", () => {
    expect(migration).toContain("'Compras'");
    expect(migration).toContain("'Representante curti Z'");
    expect(migration).toContain("'Termos do Representante curti Z'");
    expect(migration).toContain("where slug = 'representante-curtiz'");
    expect(migration).toContain("where slug = 'termos-representante'");
  });
});
