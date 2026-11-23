import { isUnknownRecord, readString, type UnknownRecord } from "../lib/unknown-data";

// An answer the buyer can act on carries a fixed code (for example PAYER_DOCUMENT_REQUIRED).
export class KitRequestError extends Error {
  constructor(message: string, readonly code = "") { super(message); }
}

export async function kitRequest(body: UnknownRecord) {
  const response = await fetch("/api/representatives/kits/orders", {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data: unknown = await response.json();
  if (!response.ok || !isUnknownRecord(data) || data.ok !== true) {
    throw new KitRequestError(isUnknownRecord(data) ? readString(data, "message", "Operação indisponível.") : "Operação indisponível.",
      isUnknownRecord(data) ? readString(data, "code") : "");
  }
  return data;
}
