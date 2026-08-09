import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608080012_payment_integration_hardening.sql",
  "utf8"
).toLowerCase();
const statusCheck = readFileSync("supabase/functions/mercadopago-status-check/index.ts", "utf8");
const refund = readFileSync("supabase/functions/mercadopago-refund/index.ts", "utf8");
const preference = readFileSync("supabase/functions/mercadopago-create-preference/index.ts", "utf8");
const webhook = readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");

describe("Mercado Pago hardening", () => {
  it("requires an authenticated local payment for status checks", () => {
    expect(statusCheck).toContain("auth.getClaims()");
    expect(statusCheck).toContain('.from("payments")');
    expect(statusCheck).not.toContain("external_reference:");
  });

  it("calculates full refunds from the local payment and audits finalization", () => {
    expect(refund).toContain('permission_code: "finance.reconcile"');
    expect(refund).toContain("Number(payment.amount)");
    expect(refund).not.toMatch(/\{\s*payment_id\?: string;\s*amount\?: number/iu);
    expect(migration).toContain("function public.finalize_mercadopago_refund");
    expect(migration).toContain("insert into public.audit_logs");
  });

  it("uses stable idempotency and persists the provider preference", () => {
    expect(preference).toContain("provider_redirect_url");
    expect(preference).toContain("order.id");
    expect(preference).not.toContain("const idempotencyKey = crypto.randomUUID()");
  });

  it("reconciles payment, order, inventory and event in one database function", () => {
    expect(webhook).toContain('db.rpc("finalize_mercadopago_payment"');
    expect(migration).toContain("perform private.convert_order_reservations");
    expect(migration).toContain("processing_status = 'processed'");
    expect(migration).toContain("set search_path = ''");
    expect(webhook).toContain('["processed", "manual_review"].includes');
    expect(webhook).toContain('existingEvent.payload_hash !== payloadHash');
  });
});
