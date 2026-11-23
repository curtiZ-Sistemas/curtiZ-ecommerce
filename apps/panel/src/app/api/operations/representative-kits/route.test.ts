import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/internal-mfa", () => ({ hasRequiredInternalMfa: async () => true }));
vi.mock("@/lib/api-rate-limit", () => ({ consumePanelMutationBudget: async () => true }));
vi.mock("@/lib/melhor-envio-server", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "test-operator" } }, error: null }) }, rpc
  }),
  createServiceSupabaseClient: () => null
}));
import { POST } from "./route";

const url = "https://panel.example/api/operations/representative-kits";
const orderId = "10000000-0000-4000-8000-000000000001";
const route = {
  name: "Rota de teste", origin_postal_code: "35524168", destination_from: "30110000",
  destination_through: "30110999", delivery_cents: 0, estimated_days: 2,
  bling_method_ids: { cash: "11" },
  point_terminal_id: null, verified_evidence: "Conferência isolada de teste", valid_until: "2099-01-01T00:00:00Z"
};
const mg02 = {
  action: "approve_mg02", representativeCode: "REP-0123ABCDEF", document: "11222333000181",
  legalName: "Empresa de teste LTDA", stateRegistration: "0012345678900",
  fiscalAddress: { state: "MG", postal_code: "35524168", street: "Rua de teste", number: "10", district: "Centro", city: "Nova Serrana" },
  buyerEvidence: "Protocolo cadastral conferido", operationEvidence: "Referência contábil conferida",
  stockEvidence: "Inventário atual conferido", homologationEvidence: "Relato do proprietário; documentos não retidos",
  validUntil: "2099-01-01T00:00:00Z"
};
const post = (body: object) => POST(new NextRequest(url, {
  method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify(body)
}));

beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: true, error: null }); });

describe("representative kit operations", () => {
  it("queues an imported NF-e for verification without confirming it in the panel", async () => {
    const invoiceKey = "31261112345678000195550030000000001123456782";
    expect((await post({ action: "submit_manual_invoice", orderId, invoiceId: 301, invoiceKey })).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_representative_kit_manual_invoice", {
      p_order: orderId, p_invoice: 301, p_key: invoiceKey
    });
  });

  it("rejects a return NF-e in the manual sale workflow", async () => {
    const invoiceKey = "31261112345678000195550040000000001123456782";
    expect((await post({ action: "submit_manual_invoice", orderId, invoiceId: 301, invoiceKey })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registers a verified MG02 account through the protected approval RPC", async () => {
    rpc.mockResolvedValueOnce({ data: 162, error: null });
    const response = await post(mg02);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_representative_kit_mg02", {
      p_representative_code: mg02.representativeCode, p_document: mg02.document, p_legal_name: mg02.legalName,
      p_state_registration: mg02.stateRegistration, p_fiscal_address: mg02.fiscalAddress,
      p_buyer_evidence: mg02.buyerEvidence, p_operation_evidence: mg02.operationEvidence,
      p_stock_evidence: mg02.stockEvidence, p_homologation_evidence: mg02.homologationEvidence,
      p_valid_until: mg02.validUntil
    });
  });

  it("rejects an invalid representative code before the database call", async () => {
    expect((await post({ ...mg02, representativeCode: "REP-unknown" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves the database permission boundary for MG02 approvals", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await post(mg02)).status).toBe(403);
  });

  it("rejects a route charging one cent before calling the database", async () => {
    const response = await post({ action: "create_route", route: { ...route, delivery_cents: 1 } });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes a free route through to the protected function", async () => {
    const response = await post({ action: "create_route", route });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("manage_representative_kit_delivery_route", { p_close: null, p_route: route });
  });

  it("accepts a prepaid-only route without inventing an at-receipt method", async () => {
    const prepaid = { ...route, bling_method_ids: {} };
    expect((await post({ action: "create_route", route: prepaid })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("manage_representative_kit_delivery_route", { p_close: null, p_route: prepaid });
  });

  it("rejects an electronic payment method when Point is missing", async () => {
    const unsupported = { ...route, point_terminal_id: null, bling_method_ids: { credit_card: "44" } };
    expect((await post({ action: "create_route", route: unsupported })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("registers inspection and the series 004 entry for a kit that returned undelivered", async () => {
    const invoiceKey = "31261112345678000195550040000000001123456782";
    const evidence = "Inspeção física de teste";
    expect((await post({ action: "register_undelivered_return", orderId, invoiceId: 300, invoiceKey,
      restockQuantity: 2, evidence })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("register_representative_kit_undelivered_return", {
      p_order: orderId, p_invoice: 300, p_key: invoiceKey, p_restock_quantity: 2, p_evidence: evidence
    });
  });

  it("exposes the MDF-e gate as a conflict for the operator", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514", message: "kit_mdfe_required" } });
    const response = await post({ action: "collection", operation: "dispatch", orderId, evidence: "Tentativa de saída" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: "Registre a conferência do MDF-e autorizado antes de registrar a saída." });
  });

  it("sends the recorded MDF-e evidence through the protected function", async () => {
    const accessKey = "31261112345678000195580010000000011123456787";
    const protocol = "100000000000006";
    const evidence = "Consulta à SEFAZ de teste";
    const response = await post({ action: "confirm_mdfe", orderId, accessKey, protocol, evidence });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("confirm_representative_kit_mdfe", {
      p_order: orderId, p_key: accessKey, p_protocol: protocol, p_evidence: evidence
    });
  });

  it("sends an inspection by SKU through the existing protected operation", async () => {
    const details = { invoiceId: 300, invoiceKey: "31261112345678000195550040000000001123456782",
      documentOrigin: "own_inflow", restockQuantity: 0, restockPairs: { "PAIR-34": 2 },
      refundInCents: 1000, inspectionReference: "Inspeção por SKU" };
    expect((await post({ action: "receive", returnId: orderId, ...details })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("manage_representative_kit_return", {
      p_return: orderId, p_action: "receive", p_details: details
    });
  });

  it("uses the delivery date selected by operations and preserves its permission check", async () => {
    expect((await post({ action: "schedule_cash_delivery", orderId, deliveryOn: "2099-02-30" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const deliveryOn = "2099-02-28";
    expect((await post({ action: "schedule_cash_delivery", orderId, deliveryOn })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("schedule_representative_kit_cash_delivery", { p_order: orderId, p_day: deliveryOn });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await post({ action: "schedule_cash_delivery", orderId, deliveryOn })).status).toBe(403);
  });
});
