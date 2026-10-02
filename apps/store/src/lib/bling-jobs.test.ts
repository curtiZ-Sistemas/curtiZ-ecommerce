import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertBlingExternalOrder, assertBlingPaidOrder, blingOrderPayload } from "./bling-jobs";

const snapshot = () => ({ order: { public_code: "CZ-TEST-ONE", status: "processing", payment_status: "approved",
  subtotal: 100, discount_total: 10, shipping_total: 15, fee_total: 0, grand_total: 105, placed_at: "2026-10-02T12:00:00Z",
  shipping_address_snapshot: { street: "Rua de teste", number: "1", district: "Bairro", city: "São Paulo", state: "SP", postal_code: "01001000" } },
  items: [{ variant_id: "variant-test", sku_snapshot: "SKU-COR-37", product_name_snapshot: "Produto no pedido",
    quantity: 2, unit_price: 50, total: 100, discount_amount: 0 }],
  productLinks: [{ variantId: "variant-test", sku: "SKU-COR-37", externalProductId: 101 }], contactId: 201, paymentMethodId: 301 });

describe("paid Bling order snapshots", () => {
  it.each(["pending", "rejected", "cancelled", "refunded", "charged_back"])("blocks %s payment", (payment_status) => {
    expect(() => assertBlingPaidOrder({ payment_status, status: "processing" })).toThrow("order_not_eligible");
  });
  it.each(["pending_payment", "cancelled", "refunded", "manual_review", "cancellation_requested", "refund_pending"])("blocks %s order", (status) => {
    expect(() => assertBlingPaidOrder({ payment_status: "approved", status })).toThrow("order_not_eligible");
  });
  it("preserves exact SKU, order reference, charged freight and discount without duplicate revenue", () => {
    const result = blingOrderPayload(snapshot());
    expect(result).toMatchObject({ numeroLoja: "CZ-TEST-ONE", itens: [{ codigo: "SKU-COR-37", quantidade: 2, valor: 50,
      descricao: "Produto no pedido", produto: { id: 101 } }], desconto: { valor: 10, unidade: "REAL" },
      transporte: { frete: 15 }, parcelas: [{ valor: 105, formaPagamento: { id: 301 } }] });
    expect(JSON.stringify(result)).not.toContain("shipping_cost");
  });
  it("blocks a missing SKU mapping before mutations", () => {
    expect(() => blingOrderPayload({ ...snapshot(), productLinks: [] })).toThrow("product_mapping_required");
  });
  it("does not match products by title or accept a conflicting SKU", () => {
    const input = snapshot();
    input.productLinks[0]!.sku = "different-sku";
    expect(() => blingOrderPayload(input)).toThrow("product_mapping_required");
  });
  it.each(["subtotal", "grand_total", "fee_total"] as const)("blocks inconsistent %s", (key) => {
    const input = snapshot(); input.order[key] += 1;
    expect(() => blingOrderPayload(input)).toThrow();
  });
  it.each([0, -1, 1.5, Number.NaN])("blocks invalid quantity %s", (quantity) => {
    const input = snapshot(); input.items[0]!.quantity = quantity;
    expect(() => blingOrderPayload(input)).toThrow();
  });
});

describe("external sale reconciliation", () => {
  const existing = () => ({ numeroLoja: "CZ-TEST-ONE", total: 105,
    itens: [{ codigo: "SKU-COR-37", quantidade: 2, valor: 50 }] });
  it("confirms a sale only when the reference, total and immutable lines agree", () => {
    const input = snapshot();
    expect(() => assertBlingExternalOrder(input.order, input.items, existing())).not.toThrow();
  });
  it.each(["numeroLoja", "total"])("rejects a conflicting %s", (field) => {
    const input = snapshot();
    expect(() => assertBlingExternalOrder(input.order, input.items, { ...existing(), [field]: "999" })).toThrow("external_order_mismatch");
  });
  it("rejects repeated external lines that hide another local SKU", () => {
    const input = snapshot();
    const items = [...input.items, { ...input.items[0]!, sku_snapshot: "SKU-COR-38" }];
    expect(() => assertBlingExternalOrder(input.order, items, { ...existing(), itens: [...existing().itens, ...existing().itens] })).toThrow("external_order_mismatch");
  });
  it("rejects changed quantity, price or absent records", () => {
    const input = snapshot();
    for (const line of [{ codigo: "SKU-COR-37", quantidade: 1, valor: 50 }, { codigo: "SKU-COR-37", quantidade: 2, valor: 51 }])
      expect(() => assertBlingExternalOrder(input.order, input.items, { ...existing(), itens: [line] })).toThrow("external_order_mismatch");
    expect(() => assertBlingExternalOrder(input.order, input.items, null)).toThrow("external_order_mismatch");
  });
});
