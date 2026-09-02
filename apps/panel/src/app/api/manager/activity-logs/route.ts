import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

type AuditFilters = {
  from: string | null;
  to: string | null;
  actor: string | null;
  action: string | null;
  module: string | null;
  origin: string | null;
  search: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionTypes = new Set(["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "APPROVE", "REJECT", "BLOCK", "UNBLOCK", "PAY", "REFUND", "EXPORT", "IMPORT", "VIEW", "OTHER"]);
const originTypes = new Set(["person", "system", "integration"]);

function dateValue(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function cleanText(value: string | null, length: number): string | null {
  const cleaned = value?.replaceAll(/[^\p{L}\p{N}\s@._:+/-]/gu, " ").trim().slice(0, length);
  return cleaned || null;
}

function cleanExact(value: string | null, length = 80): string | null {
  const cleaned = value?.replaceAll(/[^\p{L}\p{N}_.:-]/gu, "").slice(0, length);
  return cleaned || null;
}

function normalizeFilters(source: URLSearchParams): AuditFilters {
  const action = cleanExact(source.get("action"));
  const origin = cleanExact(source.get("origin"));
  const actor = source.get("actor");
  return {
    from: dateValue(source.get("from")),
    to: dateValue(source.get("to")),
    actor: actor && uuidPattern.test(actor) ? actor : null,
    action: action && actionTypes.has(action) ? action : null,
    module: cleanExact(source.get("module")),
    origin: origin && originTypes.has(origin) ? origin : null,
    search: cleanText(source.get("q"), 100)
  };
}

function rpcDates(filters: AuditFilters) {
  return {
    p_from: filters.from ? `${filters.from}T00:00:00-03:00` : null,
    p_to: filters.to ? `${nextDate(filters.to)}T00:00:00-03:00` : null
  };
}

function statusForError(code: string | undefined): number {
  return code === "42501" ? 403 : code === "22023" ? 400 : 503;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const filters = normalizeFilters(request.nextUrl.searchParams);
  const page = Math.max(1, Math.min(100_000, Number(request.nextUrl.searchParams.get("page")) || 1));
  const result = await auth.supabase.rpc("activity_log_page", {
    p_page: page,
    p_page_size: 20,
    ...rpcDates(filters),
    p_actor: filters.actor,
    p_action: filters.action,
    p_module: filters.module,
    p_origin: filters.origin,
    p_search: filters.search
  });

  if (result.error) {
    return NextResponse.json(
      { message: result.error.code === "42501" ? "Você não possui permissão para consultar a auditoria." : "Não foi possível carregar os logs de atividades." },
      { status: statusForError(result.error.code), headers: managerNoStore }
    );
  }
  return NextResponse.json(result.data, { headers: managerNoStore });
}

export async function POST(request: NextRequest) {
  if (!safeManagerOrigin(request)) {
    return NextResponse.json({ message: "Origem da solicitação não permitida." }, { status: 403, headers: managerNoStore });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 32_000) {
    return NextResponse.json({ message: "Solicitação muito grande." }, { status: 413, headers: managerNoStore });
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Solicitação inválida." }, { status: 400, headers: managerNoStore });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) || (body as { action?: unknown }).action !== "export") {
    return NextResponse.json({ message: "Ação inválida." }, { status: 400, headers: managerNoStore });
  }

  const values = body as Record<string, unknown>;
  const source = new URLSearchParams();
  for (const key of ["from", "to", "actor", "module", "origin", "q"] as const) {
    if (typeof values[key] === "string") source.set(key, values[key]);
  }
  if (typeof values.actionType === "string") source.set("action", values.actionType);
  const filters = normalizeFilters(source);
  if (!filters.from || !filters.to) {
    return NextResponse.json({ message: "Informe o período da exportação." }, { status: 400, headers: managerNoStore });
  }

  const result = await auth.supabase.rpc("export_activity_logs", {
    ...rpcDates(filters),
    p_actor: filters.actor,
    p_action: filters.action,
    p_module: filters.module,
    p_origin: filters.origin,
    p_search: filters.search
  });
  if (result.error) {
    return NextResponse.json(
      { message: result.error.code === "42501" ? "Sua permissão não permite exportar estes registros." : "Não foi possível preparar a exportação." },
      { status: statusForError(result.error.code), headers: managerNoStore }
    );
  }
  return NextResponse.json(result.data, { headers: managerNoStore });
}
