import { createHash } from "node:crypto";
import { verifyBlingSignature } from "@curtiz/integrations";
import { readBoundedBody, RequestBodyError } from "@curtiz/security";
import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body,
  { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request) {
  const secret = process.env.BLING_CLIENT_SECRET?.trim();
  if (!secret) return reply(503, { ok: false });
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
    return reply(415, { ok: false });
  let body: Uint8Array;
  try { body = await readBoundedBody(request, 64 * 1024); }
  catch (error) { return reply(error instanceof RequestBodyError ? error.status : 400, { ok: false }); }
  if (!await verifyBlingSignature(body, request.headers.get("x-bling-signature-256"), secret))
    return reply(401, { ok: false });
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(body)) as unknown; }
  catch { return reply(400, { ok: false }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply(400, { ok: false });
  const event = payload as Record<string, unknown>;
  if (typeof event.eventId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(event.eventId)
    || typeof event.event !== "string" || event.event.length > 100 || !/^[a-z_]+\.[a-z_]+$/u.test(event.event)
    || typeof event.companyId !== "string" && typeof event.companyId !== "number") return reply(400, { ok: false });
  const db = createServiceSupabaseClient();
  if (!db) return reply(503, { ok: false });
  const environment = process.env.APP_ENV === "production" ? "production" : "sandbox";
  const [account, credential] = await Promise.all([
    db.rpc("read_bling_account", { p_environment: environment }),
    db.rpc("read_integration_credential", { p_provider: "bling", p_environment: environment })
  ]);
  if (account.error || credential.error) return reply(503, { ok: false });
  const accountRow = account.data && typeof account.data === "object" && !Array.isArray(account.data)
    ? account.data as Record<string, unknown> : null;
  const credentialRow = credential.data && typeof credential.data === "object" && !Array.isArray(credential.data)
    ? credential.data as Record<string, unknown> : null;
  if (!credentialRow || credentialRow.status === "disconnected" || typeof accountRow?.companyId !== "string") return reply(503, { ok: false });
  if (String(event.companyId) !== accountRow.companyId) return reply(403, { ok: false });
  const resource = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown> : null;
  const externalId = typeof resource?.id === "number" || typeof resource?.id === "string" ? String(resource.id) : null;
  const result = await db.rpc("accept_bling_webhook", {
    p_event_id: event.eventId, p_event_type: event.event, p_company_id: String(event.companyId),
    p_resource_id: externalId, p_payload: event,
    p_payload_hash: createHash("sha256").update(body).digest("hex")
  });
  if (result.error) return reply(503, { ok: false });
  if (result.data === "conflict") return reply(409, { ok: false });
  if (result.data === "duplicate") return reply(200, { ok: true, duplicate: true });
  return result.data === "accepted" ? reply(202, { ok: true }) : reply(400, { ok: false });
}
