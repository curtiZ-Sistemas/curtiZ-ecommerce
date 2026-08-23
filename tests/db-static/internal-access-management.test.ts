import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202608230003_internal_access_management.sql"),
  "utf8"
);

describe("internal access management migration", () => {
  it("separa as permissões gerenciais e técnicas", () => {
    expect(migration).toContain("users.access.manage_client");
    expect(migration).toContain("users.access.manage_admin");
    expect(migration).toContain("users.access.manage_operator");
    expect(migration).toContain("users.access.manage_technical");
    expect(migration).toMatch(/select 'manager',[\s\S]*manage_client[\s\S]*manage_admin[\s\S]*manage_operator/u);
    expect(migration).toMatch(/select 'technical',[\s\S]*manage_technical/u);
  });

  it("protege autoalteração, gerencial e concorrência no banco", () => {
    expect(migration).toContain("p_user_id = auth.uid()");
    expect(migration).toContain("protected roles cannot be changed");
    expect(migration).toContain("p_expected_updated_at");
    expect(migration).toContain("user access changed concurrently");
    expect(migration).toContain("the last technical access cannot be removed");
  });

  it("revoga a RPC de papel único e audita a operação nova", () => {
    expect(migration).toMatch(/revoke all on function public\.admin_update_user_access[\s\S]*from authenticated/u);
    expect(migration).toContain("'user_access.changed'");
    expect(migration).toMatch(/security definer[\s\S]*set search_path = ''/u);
  });
});
