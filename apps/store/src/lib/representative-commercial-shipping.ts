import "server-only";
import { MelhorEnvioError, type MelhorEnvioProvider, type MelhorEnvioShipmentInput } from "@curtiz/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { labelGenerationConfirmed, melhorEnvioOriginParty } from "./melhor-envio-jobs";
import { melhorEnvioStatusTransition } from "./melhor-envio-webhook";
import { kitCall, kitRecord } from "./representative-test-transactions";
import type { RuntimeEnvironment } from "./runtime-environment";
import { isUnknownRecord, readNumber, readRows, readString, type UnknownRecord } from "./unknown-data";

const invalidShipment = () => new MelhorEnvioError("conflict", 409, false);
const row = (value: unknown) => isUnknownRecord(value) ? value : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";

export function buildRepresentativeKitShipment(
  environment: RuntimeEnvironment, dispatch: UnknownRecord, orderId: string, invoiceKey: string
): MelhorEnvioShipmentInput {
  const address = row(dispatch.address);
  const from = melhorEnvioOriginParty(environment);
  const to = {
    name: readString(dispatch, "buyerName"), email: readString(dispatch, "email"),
    phone: readString(dispatch, "phone").replace(/\D/gu, ""), company_document: readString(dispatch, "buyerDocument"),
    state_register: readString(dispatch, "buyerRegistration"),
    address: readString(address, "street"), number: readString(address, "number"),
    district: readString(address, "district"), city: readString(address, "city"),
    complement: readString(address, "complement"), postal_code: readString(address, "postalCode"),
    state_abbr: readString(address, "state"), country_id: "BR" as const
  };
  const serviceId = readString(dispatch, "serviceId");
  const name = readString(dispatch, "name");
  const quantity = readNumber(dispatch, "quantity");
  const price = readNumber(dispatch, "unitPriceInCents");
  const volumes = readRows(dispatch.packages).map(pack => {
    const dimensions = row(pack.dimensions);
    return { width: readNumber(dimensions, "width"), height: readNumber(dimensions, "height"),
      length: readNumber(dimensions, "length"), weight: readNumber(pack, "weight") };
  });
  if (!/^31\d{42}$/u.test(invoiceKey) || to.state_abbr !== "MG" || from.state_abbr !== "MG"
    || from.postal_code !== dispatch.originPostalCode || !/^3\d{7}$/u.test(to.postal_code)
    || !/^\d{14}$/u.test(to.company_document) || !/^\d{2,14}$/u.test(to.state_register)
    || !/^\d{10,11}$/u.test(to.phone) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(to.email)
    || [to.name, to.address, to.number, to.district, to.city, name].some(value => !value.trim())
    || !/^\d+$/u.test(serviceId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99
    || !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(price * quantity)
    || !Array.isArray(dispatch.packages) || !volumes.length || volumes.length !== dispatch.packages.length
    || volumes.some(volume => Object.values(volume).some(value => value <= 0))) throw invalidShipment();

  return { serviceId, from, to, volumes,
    products: [{ name, quantity, unitary_value: price / 100 }],
    options: { platform: environment.MELHOR_ENVIO_APP_NAME?.trim() || "curti Z",
      insurance_value: (price * quantity) / 100, receipt: false, own_hand: false, reverse: false,
      invoice: { key: invoiceKey }, tags: [{ tag: `KITMG-${orderId}`, url: null }] }
  };
}

export function commercialKitTracking(job: UnknownRecord, shipment: UnknownRecord, invoiceKey: string) {
  const orderId = readString(job, "orderId");
  const externalStatus = readString(shipment, "status").toLowerCase();
  const observed = externalStatus === "released" && labelGenerationConfirmed(shipment) ? "generated" : externalStatus;
  const status = melhorEnvioStatusTransition(readString(job, "shipmentStatus"), `order.${observed}`, observed);
  const from = row(shipment.from), to = row(shipment.to);
  if (readString(shipment, "id") !== job.shipmentId || id(row(shipment.service).id ?? shipment.service_id) !== job.serviceId
    || row(shipment.invoice).key !== invoiceKey || !readRows(shipment.tags).some(tag => tag.tag === `KITMG-${orderId}`)
    || readString(from, "postal_code").replace(/\D/gu, "") !== job.originPostalCode || from.state_abbr !== "MG"
    || readString(to, "postal_code").replace(/\D/gu, "") !== job.postalCode || to.state_abbr !== "MG") throw invalidShipment();
  const tracking = readString(shipment, "tracking") || readString(shipment, "self_tracking");
  if (tracking && !/^[A-Za-z0-9-]{1,80}$/u.test(tracking)) throw invalidShipment();
  return status ? { ...status, tracking } : null;
}

export async function advanceRepresentativeKitShipping(
  db: SupabaseClient, provider: MelhorEnvioProvider, environment: RuntimeEnvironment, job: UnknownRecord, invoiceKey: string
) {
  const orderId = readString(job, "orderId");
  const dispatch = await kitRecord(db, "read_representative_kit_dispatch", { p_order: orderId, p_invoice_key: invoiceKey });
  const shipmentId = readString(dispatch, "shipmentId");
  const claim = (operation: "shipment_cart" | "shipment_purchase" | "shipment_generate") =>
    kitCall(db, "claim_representative_kit_shipping_write", {
      p_order: orderId, p_invoice_key: invoiceKey, p_operation: operation, p_shipment: shipmentId || null
    });
  if (!shipmentId) {
    const input = buildRepresentativeKitShipment(environment, dispatch, orderId, invoiceKey);
    if (await claim("shipment_cart") !== true) return;
    const created = await provider.createShipment(input);
    if (await kitCall(db, "link_representative_kit_shipment", { p_order: orderId, p_shipment: created.externalId }) !== true) {
      throw new MelhorEnvioError("uncertain_write", 503, false);
    }
    return;
  }

  const remote = await provider.getShipment(shipmentId);
  const observe = async (observed: UnknownRecord, previous: string) => {
    const tracking = commercialKitTracking({ ...job, shipmentId, shipmentStatus: previous }, observed, invoiceKey);
    if (!tracking) return null;
    if (await kitCall(db, "record_representative_kit_tracking", {
      p_order: orderId, p_shipment: shipmentId, p_invoice_key: invoiceKey,
      p_status: tracking.status, p_tracking: tracking.tracking
    }) !== true) throw invalidShipment();
    return tracking.status;
  };
  const status = await observe(remote, readString(job, "shipmentStatus"));
  if (environment.MELHOR_ENVIO_LIVE_LABEL_PURCHASE_AUTHORIZED !== "true") return;
  if (status === "pending" && environment.MELHOR_ENVIO_LABEL_PURCHASE_ENABLED === "true") {
    const cost = Math.round(readNumber(remote, "price", Number.NaN) * 100);
    if (!Number.isSafeInteger(cost) || cost < 0 || cost > readNumber(dispatch, "costInCents", -1)) throw invalidShipment();
    if (await claim("shipment_purchase") !== true) return;
    await provider.purchase([shipmentId]);
    const confirmed = await observe(await provider.getShipment(shipmentId), "pending");
    if (!confirmed || !["ready", "label_created", "dispatched", "in_transit", "delivered"].includes(confirmed)) {
      throw new MelhorEnvioError("uncertain_write", 503, false);
    }
  }
  if (status === "ready" && environment.MELHOR_ENVIO_LABEL_GENERATION_ENABLED === "true") {
    if (await claim("shipment_generate") !== true) return;
    await provider.generate([shipmentId]);
    if (await observe(await provider.getShipment(shipmentId), "ready") !== "label_created") {
      throw new MelhorEnvioError("uncertain_write", 503, false);
    }
  }
}
