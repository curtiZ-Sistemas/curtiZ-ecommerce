import { isRepresentativeKitPostalCode, representativeKitState } from "../lib/representative-resale-scope";
import { isUnknownRecord, readRows, readString } from "../lib/unknown-data";

export type KitAddressFields = {
  recipientName: string; street: string; number: string; complement: string;
  district: string; city: string; postalCode: string;
};
export type KitAddress = KitAddressFields & {
  id: string; label: string; isDefault: boolean; title: string; line: string; place: string;
};
export type KitAddressBook = { eligible: KitAddress[]; total: number };
export type KitAddressResult = { ok: true; id: string } | { ok: false; message: string };

export const kitAddressDefaultLabel = "Entrega de kits";
export const kitAddressPostalCodeMessage = "CEP fora da área de entrega";

export function describeKitAddress(row: KitAddressFields & { label: string }) {
  return {
    title: row.label || "Endereço",
    line: [row.street, row.number].filter(Boolean).join(", "),
    place: [row.district, row.city, row.postalCode].filter(Boolean).join(" · ")
  };
}

export function readKitAddresses(rows: unknown[]): KitAddressBook {
  const eligible = readRows(rows).flatMap((row): KitAddress[] => {
    const postalCode = readString(row, "postalCode");
    const id = readString(row, "id");
    if (!id || row.state !== representativeKitState || !isRepresentativeKitPostalCode(postalCode)) return [];
    const fields = {
      recipientName: readString(row, "recipientName"), street: readString(row, "street"), number: readString(row, "number"),
      complement: readString(row, "complement"), district: readString(row, "district"), city: readString(row, "city"), postalCode
    };
    const label = readString(row, "label");
    return [{ ...fields, id, label, isDefault: row.isDefault === true, ...describeKitAddress({ ...fields, label }) }];
  });
  return { eligible, total: rows.length };
}

// Same action and payload as the customer area: `id` present means edit.
export function kitAddressPayload(fields: KitAddressFields, existing?: Pick<KitAddress, "id" | "label" | "isDefault">) {
  return {
    action: "address_save" as const,
    ...(existing ? { id: existing.id } : {}),
    label: existing?.label || kitAddressDefaultLabel,
    ...fields,
    state: representativeKitState,
    isDefault: existing?.isDefault ?? false
  };
}

async function post(body: Record<string, unknown>, fallback: string): Promise<{ data: unknown } | { message: string }> {
  try {
    const response = await fetch("/api/customer", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok || !isUnknownRecord(data)) {
      return { message: (isUnknownRecord(data) && readString(data, "message")) || fallback };
    }
    return { data };
  } catch {
    return { message: fallback };
  }
}

export async function saveKitAddress(payload: ReturnType<typeof kitAddressPayload>): Promise<KitAddressResult> {
  const result = await post(payload, "Não foi possível salvar o endereço. Tente novamente.");
  if ("message" in result) return { ok: false, message: result.message };
  const created = isUnknownRecord(result.data) ? readString(result.data, "data") : "";
  const id = created || ("id" in payload ? payload.id : "");
  return id ? { ok: true, id }
    : { ok: false, message: "Não foi possível confirmar o endereço. Atualize a página e tente novamente." };
}

export async function deleteKitAddress(id: string): Promise<KitAddressResult> {
  const result = await post({ action: "address_delete", id }, "Não foi possível excluir o endereço. Tente novamente.");
  return "message" in result ? { ok: false, message: result.message } : { ok: true, id };
}

// Keeps the choice unless it was the deleted address; then the only remaining one, or none.
export function selectionAfterDelete(selected: string, deletedId: string, remaining: KitAddress[]) {
  if (selected !== deletedId) return selected;
  return remaining.length === 1 && remaining[0] ? remaining[0].id : "";
}
