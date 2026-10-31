import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildArchivedBlingReturnPreview } from "./bling-return-preview";
import { returnTestKey, returnTestXml } from "../../../../packages/integrations/src/bling-return-test-fixture";

const returnId = "ba000000-0000-4000-8000-000000000001", orderId = "ba100000-0000-4000-8000-000000000001";
const rules = [{ scenario: "return_interstate", issuer_state: "MG", cfop: "2202", csosn: "102", icms_rate: 0,
  document_model: 55, series: 3, external_nature_id: null, pis_cst: "98", cofins_cst: "98", ipi_cst: "49",
  pis_rate: 0, cofins_rate: 0, ipi_rate: 0, ipi_cenq: "999" }];
const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
const state = { rpc: vi.fn(), from: vi.fn(), download: vi.fn() };
type Database = Parameters<typeof buildArchivedBlingReturnPreview>[0];
const db = { rpc: state.rpc, storage: { from: state.from } } as unknown as Database;
let context: { returnId: string; orderId: string; invoiceId: number; invoiceKey: string; archive: { storagePath: string; sha256: string };
  totals: { totalInCents: number; shippingInCents: number; discountInCents: number; additionalInCents: number };
  items: { id: string; variantId: string; sku: string; quantity: number; unitPriceInCents: number; requestedQuantity: number; otherReturnsQuantity: number }[] };
beforeEach(async () => {
  vi.resetAllMocks();
  const file = new Blob([returnTestXml()], { type: "application/xml" });
  const sha256 = await hash(await file.arrayBuffer());
  context = { returnId, orderId, invoiceId: 10, invoiceKey: returnTestKey, archive: { storagePath: `${orderId}/10/${sha256}.xml`, sha256 },
    totals: { totalInCents: 1200, shippingInCents: 200, discountInCents: 1000, additionalInCents: 0 },
    items: [{ id: "ba200000-0000-4000-8000-000000000001", variantId: "ba300000-0000-4000-8000-000000000001",
      sku: "TEST-PAIR", quantity: 2, unitPriceInCents: 1000, requestedQuantity: 1, otherReturnsQuantity: 1 }] };
  state.rpc.mockImplementation(async (name: string) => ({ data: name === "read_bling_return_fiscal_context" ? context : rules, error: null }));
  state.from.mockReturnValue({ download: state.download }); state.download.mockResolvedValue({ data: file, error: null });
});
describe("private archive to cumulative return preview", () => {
  it("reads only the bound private file and builds the original proportional mirror", async () => {
    const result = await buildArchivedBlingReturnPreview(db, returnId);
    expect(state.rpc).toHaveBeenCalledWith("read_bling_return_fiscal_context", { p_return_id: returnId });
    expect(state.from).toHaveBeenCalledWith("fiscal-documents");
    expect(state.download).toHaveBeenCalledOnce();
    expect(state.download).toHaveBeenCalledWith(context.archive.storagePath);
    expect(result).toMatchObject({ returnId, orderId, sourceDocumentSha256: context.archive.sha256,
      totalInCents: 600, discountInCents: 500, transmittable: false, balance: [{ remainingQuantity: 0 }] });
    expect(JSON.stringify(result)).not.toMatch(/"(?:cpf|CPF|contato|xml)":/u);
  });
  it.each([null, {}, { returnId: "bad" }])("requires a complete authorized context", async data => {
    state.rpc.mockResolvedValue({ data, error: null });
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("return_original_invoice_context_required");
    expect(state.download).not.toHaveBeenCalled();
  });
  it("blocks database failures instead of treating them as zero previous returns", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("return_context_unavailable");
  });
  it("rejects a different return identity before reading storage", async () => {
    context.returnId = "ba000000-0000-4000-8000-000000000002";
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("return_original_invoice_context_required");
    expect(state.download).not.toHaveBeenCalled();
  });
  it("never accepts an arbitrary storage path or URL", async () => {
    context.archive.storagePath = "https://example.invalid/private";
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("original_invoice_archive_mismatch");
    expect(state.download).not.toHaveBeenCalled();
  });
  it("verifies the archive digest before XML processing", async () => {
    state.download.mockResolvedValue({ data: new Blob(["not the archived document"]), error: null });
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("original_invoice_archive_mismatch");
  });
  it("does not invent a document when the private download fails", async () => {
    state.download.mockResolvedValue({ data: null, error: { code: "missing" } });
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("original_invoice_archive_unavailable");
  });
  it("rejects malformed UTF8 even when the digest matches", async () => {
    const blob = new Blob([new Uint8Array([0xc3, 0x28])]);
    context.archive.sha256 = await hash(await blob.arrayBuffer()); context.archive.storagePath = `${orderId}/10/${context.archive.sha256}.xml`;
    state.download.mockResolvedValue({ data: blob, error: null });
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("original_invoice_xml_invalid");
  });
  it("blocks cumulative excess even with an otherwise valid private document", async () => {
    context.items[0]!.otherReturnsQuantity = 2;
    await expect(buildArchivedBlingReturnPreview(db, returnId)).rejects.toThrow("return_original_balance_mismatch");
  });
});
