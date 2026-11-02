import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { archiveBlingInvoice, ensureBlingFiscalApproval } from "./bling-fiscal-automation";
import { returnTestXml } from "../../../../packages/integrations/src/bling-return-test-fixture";
const orderId = "11111111-1111-4111-8111-111111111111";
const archiveKey = "31" + "2610" + "00000000000000" + "55" + "002" + "000000001" + "1" + "00000000" + "0";
const archiveXml = () => returnTestXml().replaceAll("1".repeat(44), archiveKey)
  .replace("<ide>", "<ide><mod>55</mod><serie>2</serie><nNF>1</nNF>")
  .replace("<dest>", "<emit><CNPJ>00000000000000</CNPJ></emit><dest>");
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
          icms_rate: 0, document_model: 55, series: 2, pis_cst: "49", cofins_cst: "49", ipi_cst: "99",
          pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999", natures: [{ final_consumer: true, external_nature_id: 10 }] }]
          : name === "read_bling_catalog_variant" ? { variant: { id: "variant-test", sku: "SKU-TEST" }, metadata: {
            commercial_unit: "PR", pairs_per_sku: 1, fiscal_unit_approved: true, ncm: "64022000", origin: 0, cest: "" } }
            : name === "read_bling_invoice_archives" ? []
              : name === "read_bling_invoice_archive_context" ? { invoiceKey: archiveKey, invoiceNumber: "1", series: 2,
                issuerDocument: "00000000000000", totalInCents: 1200 } : true }));
  state.bucket.mockResolvedValue({ data: { public: false }, error: null });
  state.upload.mockResolvedValue({ error: null });
  state.document.mockImplementation(async (_key: string, format: string) => new TextEncoder().encode(format === "xml" ? archiveXml() : "%PDF-test-only").buffer);
});
describe("approved fiscal automation", () => {
  it.each([[true, true], [true, false], [false, false]])(
    "rejects an existing approval outside B2C: taxpayer=%s finalConsumer=%s", async (icms_taxpayer, final_consumer) => {
      state.rpc.mockResolvedValueOnce({ data: { mirror_hash: "a".repeat(64), icms_taxpayer, final_consumer }, error: null });
      await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toMatchObject({ code: "fiscal_scenario_not_homologated" });
      expect(state.rpc).toHaveBeenCalledTimes(1);
    });
  it("binds a paid order mirror to an approved configuration and explicit recipient", async () => {
    const result = await ensureBlingFiscalApproval(db, order, items);
    expect(result).toMatchObject({ icms_taxpayer: false, final_consumer: true, mirror_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown });
    expect(state.rpc).toHaveBeenCalledWith("save_bling_automatic_mirror_approval", expect.objectContaining({
      p_configuration_hash: "a".repeat(64), p_order_id: orderId, p_icms_taxpayer: false, p_final_consumer: true }));
  });
  it.each([{ policyApproved: false }, { policyApproved: true, configurationHash: "a".repeat(64), recipient: {} }])(
    "never invents approval or fiscal recipient", async context => {
      const original = state.rpc.getMockImplementation()!;
      state.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "read_bling_fiscal_automation_context"
        ? Promise.resolve({ data: context, error: null }) : original(name, ...args) as Promise<unknown>);
      await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toThrow();
      expect(state.rpc.mock.calls.some(([name]) => name === "save_bling_automatic_mirror_approval")).toBe(false);
    });
  it("rejects a policy changed between read and save", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "save_bling_automatic_mirror_approval"
      ? Promise.resolve({ data: false, error: null }) : original(name, ...args) as Promise<unknown>);
    await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toMatchObject({ code: "fiscal_mirror_changed" });
  });
  it("blocks absent tax parameters even under an approved policy", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, ...args: unknown[]) => {
      const result: unknown = await original(name, ...args);
      if (name !== "read_bling_fiscal_rules" || !result || typeof result !== "object" || !("data" in result)
        || !Array.isArray(result.data)) return result;
      return { ...result, data: result.data.map((rule: unknown) => rule && typeof rule === "object" ? { ...rule, ipi_cenq: null } : rule) };
    });
    await expect(ensureBlingFiscalApproval(db, order, items)).rejects.toThrow("fiscal_tax_parameters_required");
    expect(state.rpc.mock.calls.some(([name]) => name === "save_bling_automatic_mirror_approval")).toBe(false);
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
  it.each(["000001", "000000001"])("accepts the provider's zero-padded invoice number %s", async invoiceNumber => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, ...args: unknown[]) => {
      const result = await original(name, ...args) as { data: unknown; error: null };
      return name === "read_bling_invoice_archive_context"
        ? { ...result, data: { ...(result.data as Record<string, unknown>), invoiceNumber } } : result;
    });
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey);
    expect(state.rpc).toHaveBeenCalledWith("verify_bling_invoice_archive", expect.objectContaining({ p_environment: 2 }));
  });
  it.each(["000000", "000002", "1e0", "1.0", "0000000001"])("rejects invalid or different invoice number %s", async invoiceNumber => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name: string, ...args: unknown[]) => {
      const result = await original(name, ...args) as { data: unknown; error: null };
      return name === "read_bling_invoice_archive_context"
        ? { ...result, data: { ...(result.data as Record<string, unknown>), invoiceNumber } } : result;
    });
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey))
      .rejects.toThrow("fiscal_archive_identity_mismatch");
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("records the environment from the XML without inferring production", async () => {
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey);
    expect(state.rpc).toHaveBeenCalledWith("verify_bling_invoice_archive", expect.objectContaining({
      p_access_key: archiveKey, p_environment: 2, p_xml_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown }));
  });
  it("does not complete archiving if the verification acknowledgement fails", async () => {
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "verify_bling_invoice_archive"
      ? Promise.resolve({ data: false, error: null }) : original(name, ...args) as Promise<unknown>);
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey)).rejects.toThrow("fiscal_archive_unavailable");
  });
  it("refuses an invalid DANFE after XML without confirming document readiness", async () => {
    state.document.mockImplementation(async (_key: string, format: string) => new TextEncoder().encode(format === "xml" ? archiveXml() : "not-a-pdf").buffer);
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey)).rejects.toThrow("invalid_document");
    expect(state.rpc.mock.calls.some(([name]) => name === "verify_bling_invoice_archive")).toBe(false);
  });
  it("refuses an unapproved XML protocol before recording an archive or releasing shipping", async () => {
    state.document.mockResolvedValue(new TextEncoder().encode(archiveXml().replace("<cStat>100</cStat>", "<cStat>204</cStat>")).buffer);
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey))
      .rejects.toThrow("original_invoice_xml_invalid");
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("does not accept an XML from another invoice or total", async () => {
    state.document.mockResolvedValue(new TextEncoder().encode(archiveXml().replace("<nNF>1</nNF>", "<nNF>2</nNF>")).buffer);
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey))
      .rejects.toThrow("fiscal_archive_identity_mismatch");
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("archives XML and PDF by invoice and content hash, never a public URL", async () => {
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey);
    expect(state.document.mock.calls.map((call: unknown[]) => call[1])).toEqual(["xml", "pdf"]);
    expect(state.upload).toHaveBeenCalledTimes(2);
    expect(state.upload.mock.calls[0]?.[0]).toMatch(new RegExp(`^${orderId}/123/[a-f0-9]{64}\\.xml$`, "u"));
    expect(state.upload).toHaveBeenCalledWith(expect.any(String), expect.any(ArrayBuffer), expect.objectContaining({ upsert: false }));
  });
  it("does not write into an existing public bucket", async () => {
    state.bucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey)).rejects.toThrow();
    expect(state.document).not.toHaveBeenCalled();
  });
  it("recovers a previously uploaded document only after checking its actual hash", async () => {
    state.upload.mockResolvedValue({ error: { statusCode: "409" } });
    state.download.mockImplementation(async (path: string) => ({ data: new Blob([path.endsWith(".xml") ? archiveXml() : "%PDF-test-only"]), error: null }));
    await archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey);
    expect(state.download).toHaveBeenCalledTimes(2);
    state.download.mockResolvedValue({ data: new Blob(["different"]), error: null });
    await expect(archiveBlingInvoice(db, { invoiceDocument: state.document }, orderId, 123, archiveKey))
      .rejects.toMatchObject({ code: "fiscal_archive_mismatch" });
  });
});
