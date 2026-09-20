import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const lifecycle: Record<string, { status: string; rank: number }> = {
  created: { status: "pending", rank: 0 }, pending: { status: "pending", rank: 0 }, released: { status: "ready", rank: 3 },
  generated: { status: "label_created", rank: 2 }, posted: { status: "dispatched", rank: 4 },
  received: { status: "in_transit", rank: 5 }, in_transit: { status: "in_transit", rank: 5 },
  delivered: { status: "delivered", rank: 7 }, undelivered: { status: "delayed", rank: 6 },
  not_delivered: { status: "delayed", rank: 6 }, paused: { status: "delayed", rank: 6 },
  suspended: { status: "delayed", rank: 6 },
  returned: { status: "returned", rank: 8 }, canceled: { status: "cancelled", rank: 8 },
  cancelled: { status: "cancelled", rank: 8 }, expired: { status: "cancelled", rank: 8 }
};
const internalRank: Record<string, number> = { pending: 0, label_created: 2, ready: 3, dispatched: 4,
  in_transit: 5, delayed: 6, delivered: 7, returned: 8, cancelled: 8 };

export function melhorEnvioStatusTransition(currentStatus: string, event: string, externalStatus: string) {
  const normalized = lifecycle[externalStatus.toLowerCase()] ?? lifecycle[event.replace(/^order\./u, "")];
  if (!event.startsWith("order.") || !normalized || normalized.rank < (internalRank[currentStatus] ?? 0)) return null;
  return normalized;
}

export function verifyMelhorEnvioSignature(rawBody: Uint8Array, supplied: string, applicationSecret: string): boolean {
  if (!supplied || !applicationSecret) return false;
  const expected = createHmac("sha256", applicationSecret).update(rawBody).digest();
  let received: Buffer;
  try { received = Buffer.from(supplied, "base64"); }
  catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}
