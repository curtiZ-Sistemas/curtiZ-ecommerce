import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609110002_payment_intent_checkout.sql", "utf8");

describe("checkout orientado a intenção de pagamento", () => {
  it("separa cotação sem pedido da confirmação com método obrigatório", () => {
    const preview = migration.slice(
      migration.indexOf("function public.preview_professional_checkout"),
      migration.indexOf("function public.confirm_professional_checkout_order")
    );
    expect(preview).not.toContain("insert into public.orders");
    expect(migration).toContain("invalid_payment_method");
    expect(migration).toContain("p_payment_method_id text");
    expect(migration).toContain("p_customer_id uuid");
    expect(migration).toContain("revoke all on function public.create_professional_checkout_order");
    expect(migration).toContain("to service_role;");
  });

  it("mantém idempotência de pedido e de tentativas de pagamento", () => {
    expect(migration).toContain("unique(provider, idempotency_key)");
    expect(migration).toContain("on conflict(provider,idempotency_key) do update");
    expect(migration).toContain("function public.begin_mercadopago_payment_attempt");
  });

  it("mantém snapshot histórico e permite nova tentativa após recusa", () => {
    expect(migration).toContain("'recipient_name', trim(p_customer_name)");
    expect(migration).toContain("'postal_code', p_shipping_address->>'postalCode'");
    expect(migration).toContain("elsif p_status='rejected'");
    expect(migration).not.toContain("p_status in ('rejected','cancelled')");
  });

  it("persiste CPF criptografado fora do perfil público para reutilização", () => {
    expect(migration).toContain("private.customer_checkout_identity");
    expect(migration).toContain("revoke all on table private.customer_checkout_identity from public, anon, authenticated");
    expect(migration).toContain("function public.save_my_checkout_identity");
    expect(migration).toContain("on delete cascade");
    expect(migration).toContain("function private.purge_checkout_identity_on_profile_disable");
    expect(migration).toContain("returns trigger language plpgsql security definer set search_path = ''");
  });

  it("protege tentativas por RLS e gera Casa 2 no servidor", () => {
    expect(migration).toContain("alter table public.payment_attempts force row level security");
    expect(migration).toContain("sale.customer_id = auth.uid()");
    expect(migration).toContain("base_label || ' ' || next_suffix");
    expect(migration).toContain("address-save:' || auth.uid()::text");
  });
});
