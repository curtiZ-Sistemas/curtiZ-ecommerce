import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261029120000_public_company_identification.sql", "utf8");

describe("public company identification", () => {
  it("runs as security definer with a fixed search_path", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
  });

  it("exposes only the legally required fields, once the registration is complete and the CNPJ is well-formed", () => {
    expect(migration).toContain("company.completeness_status = 'complete'");
    expect(migration).toContain("'^[0-9]{14}$'");
    for (const column of ["legal_name", "trade_name", "tax_id", "address", "email", "phone", "support_channel"]) {
      expect(migration).toContain(`company.${column}`);
    }
    for (const internal of ["privacy_channel", "data_protection_contact", "updated_by"]) {
      expect(migration).not.toContain(internal);
    }
  });

  it("is executable by the public storefront only through an explicit grant", () => {
    expect(migration).toContain("revoke all on function public.public_company_identification() from public;");
    expect(migration).toContain("grant execute on function public.public_company_identification() to anon, authenticated;");
  });
});
