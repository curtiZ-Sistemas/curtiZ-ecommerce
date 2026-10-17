import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { archiveBlingInvoice, ensureBlingFiscalApproval } from "./bling-fiscal-automation";
const orderId = "11111111-1111-4111-8111-111111111111";
const order = { id: orderId, customer_id: "customer-test", shipping_address_snapshot: { state: "MG" }, grand_total: 20, shipping_total: 0, discount_total: 0, fee_total: 0 };
const items = [{ variant_id: "variant-test", sku_snapshot: "SKU-TEST", product_name_snapshot: "Test", quantity: 1, unit_price: 20 }];
const state = { rpc: vi.fn(), bucket: vi.fn(), upload: vi.fn(), download: vi.fn(), document: vi.fn() };
// The production functions receive the real client; the fixture implements only their used boundary.
const db = { rpc: state.rpc, storage: { getBucket: state.bucket,
  from: () => ({ upload: state.upload, download: state.download }) } } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data:
    name === "read_bling_fiscal_mirror_approval" ? null
      : name === "read_bling_fiscal_automation_context" ? { configurationHash: "a".repeat(64), policyApproved: true,
        recipient: { icms_taxpayer: false, final_consumer: true } }
        : name === "read_bling_fiscal_rules" ? [{ scenario: "sale_in_state", issuer_state: "MG", cfop: "5102", csosn: "102",
          icms_rate: 0, document_model: 55, series: 2, natures: [{ final_consumer: true, external_nature_id: 10 }] }]
          : name === "read_bling_catalog_variant" ? { variant: { id: "variant-test", sku: "SKU-TEST" }, metadata: {
            commercial_unit: "PR", pairs_per_sku: 1, fiscal_unit_approved: true, ncm: "64022000", origin: 0, cest: "" } }
            : name === "read_bling_invoice_archives" ? [] : true }));
  state.bucket.mockResolvedValue({ data: { public: false }, error: null });
  state.upload.mockResolvedValue({ error: null });
  state.document.mockResolvedValue(new TextEncoder().encode("test-only-document").buffer);
});
describe("approved fiscal automation", () => {
  it("binds a paid order mirror to an approved configuration and explicit recipient", async () => {
    const result = await ensureBlingFiscalApproval(db, order, items);
    expect(result).toMatchObject({ icms_taxpayer: false, final_consumer: true, mirror_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown });
    expect(state.rpc).toHaveBeenCalledWith("save_bling_automatic_mirror_approval", expect.objectContaining({
      p_configuration_hash: "a".repeat(64), p_order_id: orderId, p_icms_taxpayer: false, p_final_consumer: true }));
  });
  it.each([{ policyApproved: false }, { policyApproved: true, configurationHash: "a".repeat(64), recipient: {} }])(
    "never invents approval or fiscal recipient", async context => {
      const original = state.rpc.getMockImplementation();
      state.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "read_bling_fiscal_automation_context"
        ? Promise.resolve({ data: context, error: null }) : original?.(name, ...args));
      await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toThrow();
      expect(state.rpc.mock.calls.some(([name]) => name === "save_bling_automatic_mirror_approval")).toBe(false);
    });
  it("rejects a policy changed between read and save", async () => {
    const original = state.rpc.getMockImplementation();
    state.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "save_bling_automatic_mirror_approval"
      ? Promise.resolve({ data: false, error: null }) : original?.(name, ...args));
    await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toMatchObject({ code: "fiscal_mirror_changed" });
  });
  it("preserves an existing exact approval without replacing it under a new policy", async () => {
    const approval = await ensureBlingFiscalApproval(db, order, items);
    state.rpc.mockClear();
    state.rpc.mockResolvedValueOnce({ data: approval, error: null });
    expect(await ensureBlingFiscalApproval(db, order, items)).toEqual(approval);
    expect(state.rpc.mock.calls.some(([name]) => name === "save_bling_automatic_mirror_approval")).toBe(false);
  });
  it("does not reuse an old approval after an order snapshot changes", async () => {
    const approval = await ensureBlingFiscalApproval(db, order, items);
    state.rpc.mockResolvedValueOnce({ data: approval, error: null });
    await expect(ensureBlingFiscalApproval(db, { ...order, customer_name_snapshot: "Changed" }, items))
      .rejects.toMatchObject({ code: "fiscal_mirror_changed" });
  });
});
describe("private fiscal archiving", () => {
  it("archives XML and PDF by invoice and content hash, never a public URL", async () => {
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, "1".repeat(44));
    expect(state.document.mock.calls.map(([, format]) => format)).toEqual(["xml", "pdf"]);
    expect(state.upload).toHaveBeenCalledTimes(2);
    expect(state.upload.mock.calls[0]?.[0]).toMatch(new RegExp(`^${orderId}/123/[a-f0-9]{64}\\.xml$`, "u"));
    expect(state.upload.mock.calls.every(([, , options]) => options.upsert === false)).toBe(true);
  });
  it("does not write into an existing public bucket", async () => {
    state.bucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, "1".repeat(44))).rejects.toThrow();
    expect(state.document).not.toHaveBeenCalled();
  });
  it("recovers a previously uploaded document only after checking its actual hash", async () => {
    state.upload.mockResolvedValue({ error: { statusCode: "409" } });
    state.download.mockResolvedValue({ data: new Blob(["test-only-document"]), error: null });
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, "1".repeat(44));
    expect(state.download).toHaveBeenCalledTimes(2);
    state.download.mockResolvedValue({ data: new Blob(["different"]), error: null });
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, "1".repeat(44)))
      .rejects.toMatchObject({ code: "fiscal_archive_mismatch" });
  });
});
