import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/unknown-data", () => import("./unknown-data"));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MelhorEnvioProvider } from "@curtiz/integrations";
import { advanceRepresentativeKitShipping, buildRepresentativeKitShipment } from "./representative-commercial-shipping";

const orderId = "10000000-0000-4000-8000-000000000001";
const key = "31" + "1".repeat(42);
const origin = {
  MELHOR_ENVIO_ORIGIN_NAME: "Fixture de saída", MELHOR_ENVIO_ORIGIN_EMAIL: "fixture@example.invalid",
  MELHOR_ENVIO_ORIGIN_PHONE: "3112341234", MELHOR_ENVIO_ORIGIN_ADDRESS: "Rua de teste",
  MELHOR_ENVIO_ORIGIN_NUMBER: "1", MELHOR_ENVIO_ORIGIN_DISTRICT: "Centro", MELHOR_ENVIO_ORIGIN_CITY: "Nova Serrana",
  MELHOR_ENVIO_ORIGIN_STATE: "MG", MELHOR_ENVIO_ORIGIN_POSTAL_CODE: "35520000",
  MELHOR_ENVIO_ORIGIN_COMPANY_DOCUMENT: "12345678000195"
};
const dispatch = {
  shipmentId: null, serviceId: "1", originPostalCode: "35520000", costInCents: 1800,
  address: { state: "MG", postalCode: "30110100", street: "Rua de teste", number: "2", city: "Belo Horizonte", district: "Centro" },
  buyerName: "Cliente de teste", buyerDocument: "11222333000181", buyerRegistration: "0012345678900",
  phone: "3112345678", email: "buyer@example.invalid", name: "Kit de teste", quantity: 2, unitPriceInCents: 5000,
  packages: [{ dimensions: { width: 10,height: 5,length: 20 },weight: 0.25 }]
};
const job = { orderId, serviceId: "1", originPostalCode: "35520000", postalCode: "30110100", shipmentStatus: "pending" };
const remote = {
  id: "fixture-label", service_id: 1, status: "pending", price: 18,
  invoice: { key }, tags: [{ tag: `KITMG-${orderId}` }], from: { state_abbr: "MG",postal_code: "35520000" },
  to: { state_abbr: "MG",postal_code: "30110100" }
};
const liveFlags = { ...origin, MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED: "true", MELHOR_ENVIO_LABEL_PURCHASE_ENABLED: "true" };
function fixture(context: object) {
  const rpc = vi.fn(async (name: string) => ({ data: name === "read_representative_kit_dispatch" ? context : true }));
  const db = { rpc } as unknown as SupabaseClient;
  const mock = { createShipment: vi.fn(), getShipment: vi.fn(), purchase: vi.fn(), generate: vi.fn() };
  return { rpc, db, mock, provider: mock as unknown as MelhorEnvioProvider };
}

describe("representative commercial shipping", () => {
  it("builds volumes from the confirmed quote and refuses an interstate address", () => {
    const input = buildRepresentativeKitShipment(origin, dispatch,orderId,key);
    expect(input.options).toMatchObject({ invoice: { key },insurance_value: 100 });
    expect(input.volumes).toEqual([{ width: 10,height: 5,length: 20,weight: 0.25 }]);
    expect(() => buildRepresentativeKitShipment(origin,{ ...dispatch,address: { ...dispatch.address,state: "SP" } },orderId,key)).toThrow();
  });

  it("requires durable claim before creating a cart entry and does not purchase at this stage", async () => {
    const { db, mock, provider,rpc } = fixture(dispatch);
    mock.createShipment.mockResolvedValueOnce({ externalId: "fixture-label" });
    await advanceRepresentativeKitShipping(db,provider,liveFlags,job,key);
    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      "read_representative_kit_dispatch","claim_representative_kit_shipping_write","link_representative_kit_shipment"
    ]);
    expect(mock.createShipment).toHaveBeenCalledOnce();
    expect(mock.purchase).not.toHaveBeenCalled();
  });

  it("observes a paid label after purchase with the exact original quote and fiscal link", async () => {
    const { db, mock, provider } = fixture({ ...dispatch, shipmentId: remote.id });
    mock.getShipment.mockResolvedValueOnce(remote).mockResolvedValueOnce({ ...remote,status: "paid" });
    await advanceRepresentativeKitShipping(db,provider,liveFlags,job,key);
    expect(mock.purchase).toHaveBeenCalledWith(["fixture-label"]);
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it.each([{ ...remote, price: 18.01 },{ ...remote, invoice: { key: "different" } }])(
    "refuses to buy a label with a mismatched fiscal or freight readback",async observed => {
      const { db, mock, provider } = fixture({ ...dispatch, shipmentId: remote.id });
      mock.getShipment.mockResolvedValue(observed);
      await expect(advanceRepresentativeKitShipping(db,provider,liveFlags,job,key)).rejects.toThrow();
      expect(mock.purchase).not.toHaveBeenCalled();
    }
  );
});
