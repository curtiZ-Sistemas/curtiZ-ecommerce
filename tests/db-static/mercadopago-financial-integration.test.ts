import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202609110003_mercadopago_financial_integration.sql",
  "utf8"
).toLowerCase();
const compactMigration = migration.replace(/\s+/gu, " ");
const webhook = readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
const refund = readFileSync("supabase/functions/mercadopago-refund/index.ts", "utf8");

describe("integração financeira Mercado Pago", () => {
  it("vincula pedido, pagamento, conta a receber e lançamento com unicidade", () => {
    expect(migration).toContain("add column order_id uuid references public.orders(id)");
    expect(migration).toContain("add column payment_id uuid references public.payments(id)");
    expect(migration).toContain("accounts_receivable_payment_unique");
    expect(compactMigration).toContain("on conflict (payment_id) where payment_id is not null");
    expect(compactMigration).toContain("on conflict (receivable_id) where receivable_id is not null");
  });

  it("separa valores reais de bruto, taxa, líquido e parcelas", () => {
    expect(migration).toContain("provider_fee_confirmed");
    expect(migration).toContain("net_received_amount");
    expect(migration).toContain("provider_installments");
    expect(webhook).toContain("payment.fee_details");
    expect(webhook).toContain("payment.transaction_details?.net_received_amount");
    expect(webhook).not.toMatch(/estim|estimate/i);
  });

  it("torna webhooks e reembolsos totais ou parciais idempotentes", () => {
    expect(webhook).toContain('existingEvent.payload_hash !== payloadHash');
    expect(webhook).toContain('["processed", "manual_review"].includes');
    expect(refund).toContain('db.rpc("begin_mercadopago_refund"');
    expect(refund).toContain("amount_in_cents");
    expect(refund).toContain("idempotency_key");
    expect(migration).toContain("refund idempotency conflict");
    expect(migration).toContain("refund exceeds payment");
    expect(compactMigration).toContain("where provider_refund_id = p_provider_refund_id");
    expect(migration).toContain("provider refund conflict");
  });

  it("registra taxas, reembolsos, transferências e auditoria sem duplicar resultado", () => {
    expect(migration).toContain("accounts_payable_payment_fee_unique");
    expect(migration).toContain("accounts_payable_payment_refund_unique");
    expect(migration).toContain("financial_transaction_transfer_side_unique");
    expect(migration).toContain("affects_result boolean not null default true");
    expect(migration).toMatch(/'transfer'\s*,\s*transfer_row\.id\s*,\s*'transferência entre contas'[\s\S]*?false/iu);
    expect(migration).toContain("insert into public.audit_logs");
  });

  it("mantém RLS e escrita financeira nas RPCs autorizadas", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("force row level security");
    expect(migration).toContain("private.require_permission('finance.manage')");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("automatic receivable must be reconciled by provider");
  });
});
