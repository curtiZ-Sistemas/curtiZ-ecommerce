import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase", "migrations", name), "utf8").toLowerCase();

describe("representative migrations without a local database", () => {
  const core = migration("202607310003_representative_core.sql");
  const creatives = migration("202607310004_representative_creatives.sql");
  const hardening = migration("202608010001_security_hardening.sql");
  const saleTransaction = migration("202608010002_representative_sale_transaction.sql");
  const referralAttribution = migration("202608010003_referral_attribution.sql");
  const portal = migration("202608030005_representative_portal.sql");

  it("keeps privileged functions on an explicit empty search path", () => {
    const privilegedFunctions = [
      ...core.matchAll(/security definer/g),
      ...creatives.matchAll(/security definer/g)
    ];
    const protectedFunctions = [
      ...core.matchAll(/security definer set search_path = ''/g),
      ...creatives.matchAll(/security definer set search_path = ''/g)
    ];

    expect(privilegedFunctions.length).toBeGreaterThan(0);
    expect(protectedFunctions).toHaveLength(privilegedFunctions.length);
  });

  it("enables RLS and defines ownership and internal permission policies", () => {
    expect(core).toContain("enable row level security");
    expect(core).toContain('create policy "applicant reads application"');
    expect(core).toContain('create policy "commission owner read"');
    expect(creatives).toContain("enable row level security");
    expect(creatives).toContain('create policy "creative audience read"');
    expect(creatives).toContain("private.has_permission('creatives.manage')");
  });

  it("guards referral cycles and financial idempotency", () => {
    expect(core).toContain("prevent_referral_cycle");
    expect(core).toContain("referral cycle is forbidden");
    expect(core.match(/idempotency_key text not null unique/g)?.length).toBeGreaterThanOrEqual(3);
    expect(core).toContain("unique(source_event, source_event_id, representative_id, rule_id)");
  });

  it("keeps documents and creatives in private storage buckets", () => {
    expect(core).toMatch(
      /'representative-documents'\s*,\s*'representative-documents'\s*,\s*false/
    );
    expect(creatives).toMatch(
      /'representative-creatives'\s*,\s*'representative-creatives'\s*,\s*false/
    );
    expect(creatives).toContain('create policy "creative audience reads permitted assets"');
  });

  it("forces RLS and rate-limits authentication without raw PII", () => {
    expect(hardening).toContain("force row level security");
    expect(hardening).toContain("private.auth_rate_limits");
    expect(hardening).toContain("security definer");
    expect(hardening).toContain("set search_path = ''");
    expect(hardening).not.toContain("email text");
    expect(hardening).not.toContain("ip_address");
  });

  it("registers representative sales atomically from server-owned prices", () => {
    expect(saleTransaction).toContain("security definer");
    expect(saleTransaction).toContain("set search_path = ''");
    expect(saleTransaction).toContain("pg_advisory_xact_lock");
    expect(saleTransaction).toContain("for update of inventory");
    expect(saleTransaction).toContain("coalesce(item.price_override, item.base_price)");
    expect(saleTransaction).toContain("representative_inventory_movements");
    expect(saleTransaction).toContain("representative.sale.recorded");
    expect(saleTransaction).not.toContain("p_total");
    expect(saleTransaction).not.toContain("p_price");
  });

  it("captures immutable referrals and converts them without cycles", () => {
    expect(referralAttribution).toContain("force row level security");
    expect(referralAttribution).toContain("self referral is forbidden");
    expect(referralAttribution).toContain("referral attribution is immutable");
    expect(referralAttribution).toContain("private.rebuild_representative_network_closure()");
    expect(referralAttribution).toContain("security definer");
    expect(referralAttribution).toContain("set search_path = ''");
    expect(referralAttribution).toContain("grant execute on function public.is_valid_referral_code(text) to anon");
  });

  it("keeps portal mutations server-owned, idempotent and auditable", () => {
    expect(portal).toContain("create_representative_kit_order");
    expect(portal).toContain("cancel_representative_sale");
    expect(portal).toContain("set_representative_sale_metadata");
    expect(portal).toContain("get_representative_network");
    expect(portal).toContain("pg_advisory_xact_lock");
    expect(portal).toContain("for update");
    expect(portal).toContain("representative_inventory_movements");
    expect(portal).toContain("sale_cancellation");
    expect(portal).toContain("kit_delivery");
    expect(portal).toContain("security definer");
    expect(portal).toContain("set search_path = ''");
    expect(portal).not.toContain("p_price");
    expect(portal).not.toContain("p_total");
  });

  it("limits network data and notification updates to the authenticated owner", () => {
    expect(portal).toContain("owner.user_id = auth.uid()");
    expect(portal).toContain("owner.status in ('active', 'unqualified', 'approved_waiting_kit')");
    expect(portal).toContain("limit least(greatest(p_limit, 1), 50)");
    expect(portal).toContain('create policy "representative updates own notification"');
    expect(portal).toContain("private.owns_representative(representative_id)");
  });
});
