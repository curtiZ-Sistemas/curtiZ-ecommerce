import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(process.cwd(), "supabase", "migrations");
const file = "20261124050000_representative_kit_card_payment.sql";
const sql = readFileSync(resolve(dir, file), "utf8").toLowerCase();
const body = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
};

describe("representative kit card payment migration", () => {
  it("is the newest migration and never edits an applied one", () => {
    const names = readdirSync(dir).filter(name => name.endsWith(".sql")).sort();
    expect(names.at(-1)).toBe(file);
    expect(sql).not.toMatch(/\bdrop function/u);
  });

  it("adds the method, attempt and refused-attempt memory to the order aggregate only", () => {
    expect(sql).toMatch(/alter table private\.representative_kit_orders\s+add column payment_method text check \(payment_method in \('card'\)\)/u);
    expect(sql).toContain("card_attempt_id uuid");
    expect(sql).toContain("card_rejected_payment_ids text[] not null default '{}'");
  });

  it("keeps every new or replaced function security definer with an empty search_path", () => {
    const definitions = sql.match(/create (?:or replace )?function public\.[a-z_]+\([\s\S]*?\$\$;/gu) ?? [];
    expect(definitions.length).toBeGreaterThanOrEqual(7);
    for (const definition of definitions) {
      expect(definition).toContain("security definer set search_path = ''");
    }
  });

  it("grants the new functions to the service role only", () => {
    for (const signature of [
      "claim_representative_kit_card(uuid,uuid,boolean)", "release_representative_kit_card_claim(uuid,uuid,uuid)",
      "expire_representative_kit_card_claim(uuid)"
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });

  it("claims the card with the same rules as the Pix", () => {
    const card = body("claim_representative_kit_card");
    const pix = body("claim_representative_kit_pix");
    for (const rule of [
      "for update", "o.payment_started_at is not null then return null", "o.state <> 'reserved'", "o.reserved_until <= clock_timestamp()",
      "private.representative_kit_payment_allowed(o)", "a.revoked_at is not null", "a.valid_until <= clock_timestamp()",
      "kit_payer_document_required", "payment_started_at = clock_timestamp()", "interval '30 minutes'"
    ]) {
      expect(card).toContain(rule);
      expect(pix).toContain(rule);
    }
    expect(card).toContain("payment_method = 'card'");
    expect(card).toContain("card_attempt_id = gen_random_uuid()");
  });

  it("only returns a claim that has no provider payment, and only to its own buyer or after the window", () => {
    const release = body("release_representative_kit_card_claim");
    expect(release).toMatch(/actor_id = p_actor/u);
    expect(release).toContain("card_attempt_id = p_attempt");
    expect(release).toContain("provider_payment_id is null");
    const expire = body("expire_representative_kit_card_claim");
    expect(expire).toContain("provider_payment_id is null");
    expect(expire).toContain("payment_expires_at <= clock_timestamp()");
  });

  it("lets a refused card try again, while a refused Pix still cancels and releases the stock", () => {
    const settle = body("settle_representative_kit_payment");
    expect(settle).toContain("p_status = 'rejected' and refund_total = 0 and o.payment_method = 'card' and o.cancellation_requested_at is null");
    expect(settle).toMatch(/elsif p_status in \('cancelled','expired','rejected'\) and refund_total = 0 then\s+next_state := 'cancelled';\s+next_stock := 'released';/u);
    expect(settle).toContain("card_rejected_payment_ids = array_append(card_rejected_payment_ids, p_payment_id)");
    // The retry path returns before any stock movement: the hold is kept, never released twice.
    expect(settle.indexOf("if card_retry then")).toBeLessThan(settle.indexOf("transfer_representative_kit_inventory"));
    expect(settle).toMatch(/if found and p_payment_id = any\(o\.card_rejected_payment_ids\)/u);
  });

  it("keeps the settlement identity, amount and refund ledger checks of the original", () => {
    const settle = body("settle_representative_kit_payment");
    for (const check of [
      "kit_payment_identity_mismatch", "p_amount is distinct from (o.unit_price_cents * o.quantity + o.shipping_cents)",
      "p_currency is distinct from 'brl'", "kit_refund_identity_mismatch", "kit_refund_amount_mismatch",
      "next_state := 'refunded'", "'charged_back'", "next_state := 'manual_review'", "interval '2 days'"
    ]) expect(settle).toContain(check);
  });

  it("exposes the payment method to the reader and to the recovery worker", () => {
    expect(body("read_representative_kit_payment")).toContain("'paymentmethod',o.payment_method");
    expect(body("due_representative_kit_payments")).toContain('payment_method as "paymentmethod"');
  });
});
