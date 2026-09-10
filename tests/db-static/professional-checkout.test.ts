import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609100004_professional_checkout.sql", "utf8");

describe("checkout profissional", () => {
  it("limita endereços no banco e mantém operações vinculadas ao usuário autenticado", () => {
    expect(migration).toContain(">= 3");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("calcula e aplica cupom no banco sem alterar o frete", () => {
    expect(migration).toContain("function public.preview_checkout_coupon");
    expect(migration).toContain("function public.apply_checkout_coupon");
    expect(migration).toContain("grand_total = subtotal - discount + shipping_total");
    expect(migration).not.toContain("shipping_total =");
  });

  it("revoga acesso público às funções sensíveis", () => {
    expect(migration).toContain("revoke all on function public.apply_checkout_coupon(uuid,text) from public, anon");
    expect(migration).toContain("revoke all on function private.enforce_customer_address_limit() from public, anon, authenticated");
  });
});
