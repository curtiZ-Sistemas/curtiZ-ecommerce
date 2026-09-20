import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202609160003_melhor_envio_shipping.sql", "utf8");

describe("migration Melhor Envio", () => {
  it("persiste OAuth server-only com lock de refresh e state de uso único", () => {
    expect(migration).toContain("create table if not exists private.integration_credentials");
    expect(migration).toContain("refresh_locked_until");
    expect(migration).toContain("primary key(provider,environment)");
    expect(migration).toContain("consumed_at is null and expires_at>now()");
    expect(migration).toContain("grant execute on function public.read_integration_credential(text,text) to service_role");
    expect(migration).not.toContain("grant execute on function public.read_integration_credential(text,text) to authenticated");
  });

  it("vincula cotação a cliente, fingerprint, CEP, expiração e uso único", () => {
    expect(migration).toContain("selected.customer_id is distinct from p_customer_id");
    expect(migration).toContain("selected.expires_at <= now()");
    expect(migration).toContain("selected.cart_fingerprint <> p_cart_fingerprint");
    expect(migration).toContain("selected.destination_postal_code <> normalized_postal");
    expect(migration).toContain("checkout_key.resource_id=selected.order_id");
    expect(migration).toContain("if not exact_replay then raise exception 'shipping_quote_expired'");
    expect(migration).toContain("update public.shipping_quotes set used_at=coalesce(used_at,now()),order_id=created_order_id");
  });

  it("mantém N remessas, idempotência e bloqueio fiscal de produção", () => {
    expect(migration).toContain("create unique index if not exists shipments_provider_external_uidx");
    expect(migration).toContain("insert into public.order_shipments(order_id,shipment_id)");
    expect(migration).toContain("quote.provider_environment='sandbox'");
    expect(migration).toContain("else 'awaiting_invoice' end");
    expect(migration).toContain("on conflict(idempotency_key) do nothing");
  });

  it("protege eventos do webhook com RLS e chave idempotente", () => {
    expect(migration).toContain("alter table public.shipping_webhook_events force row level security");
    expect(migration).toContain("unique(provider,provider_event_key)");
    expect(migration).toContain("revoke insert,update,delete,truncate on public.shipping_webhook_events from anon,authenticated");
    expect(migration).toContain("create or replace function public.apply_melhor_envio_webhook");
    expect(migration).toContain("for update;");
    expect(migration).toContain("grant execute on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) to service_role");
    expect(migration).not.toContain("grant execute on function public.apply_melhor_envio_webhook(text,text,text,text,text,timestamptz,text) to authenticated");
  });

  it("consome jobs com lease e não recupera automaticamente escrita externa incerta", () => {
    expect(migration).toContain("create or replace function public.claim_melhor_envio_job");
    expect(migration).toContain("for update skip locked limit 1");
    expect(migration).toContain("status='pending'");
    expect(migration).toContain("create or replace function public.finish_melhor_envio_job");
    expect(migration).toContain("grant execute on function public.claim_melhor_envio_job(uuid) to service_role");
  });
});
