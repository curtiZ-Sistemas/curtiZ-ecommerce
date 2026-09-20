import { createHash } from "node:crypto";
import { readBoundedBody, RequestBodyError } from "@curtiz/security";
import { NextResponse } from "next/server";
import { melhorEnvioStatusTransition, verifyMelhorEnvioSignature } from "@/lib/melhor-envio-webhook";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readString } from "@/lib/unknown-data";

const noStore = { "cache-control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: noStore });

export async function POST(request: Request) {
  const secret = process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim() ?? "";
  if (!secret) return reply({ ok: false }, 503);
  let rawBytes: Uint8Array;
  try { rawBytes = await readBoundedBody(request, 64 * 1024); }
  catch (error) { return reply({ ok: false }, error instanceof RequestBodyError ? error.status : 400); }
  const supplied = request.headers.get("x-me-signature")?.trim() ?? "";
  if (!verifyMelhorEnvioSignature(rawBytes, supplied, secret)) return reply({ ok: false }, 401);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(rawBytes)) as unknown; }
  catch { return reply({ ok: false }, 400); }
  if (!isUnknownRecord(parsed) || !isUnknownRecord(parsed.data)) return reply({ ok: false }, 400);
  const event = readString(parsed, "event");
  const data = parsed.data;
  const externalId = readString(data, "id");
  const externalStatus = readString(data, "status").toLowerCase();
  if (!event.startsWith("order.") || !externalId) return reply({ ok: true, ignored: true });
  const payloadHash = createHash("sha256").update(rawBytes).digest("hex");
  const statusTimestampField: Record<string, string> = { released: "paid_at", cancelled: "canceled_at", canceled: "canceled_at" };
  const suppliedOccurredAt = readString(data, statusTimestampField[externalStatus] ?? `${externalStatus}_at`)
    || readString(data, "updated_at") || readString(data, "created_at");
  const occurredAt = suppliedOccurredAt && Number.isFinite(Date.parse(suppliedOccurredAt))
    ? new Date(suppliedOccurredAt).toISOString() : new Date().toISOString();
  const eventKey = createHash("sha256").update(`${event}:${externalId}:${suppliedOccurredAt || payloadHash}`).digest("hex");
  const db = createServiceSupabaseClient();
  if (!db) return reply({ ok: false }, 503);
  const normalized = melhorEnvioStatusTransition("", event, externalStatus);
  const applied = await db.rpc("apply_melhor_envio_webhook", {
    p_event_key: eventKey, p_payload_hash: payloadHash, p_event_type: event, p_external_id: externalId,
    p_status: normalized?.status ?? null, p_occurred_at: occurredAt,
    p_tracking_code: readString(data, "tracking") || readString(data, "self_tracking") || null
  });
  if (applied.error || applied.data === "failed") return reply({ ok: false }, 503);
  if (applied.data === "hash_conflict") return reply({ ok: false }, 409);
  if (applied.data === "duplicate") return reply({ ok: true, duplicate: true });
  if (applied.data === "ignored") return reply({ ok: true, ignored: true });
  return applied.data === "processed" ? reply({ ok: true }) : reply({ ok: false }, 503);
}
