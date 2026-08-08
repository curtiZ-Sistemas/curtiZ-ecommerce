import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeTechnicalRequest,
  isAuthorizedTechnicalDemo,
  sanitizeTechnicalValue,
  technicalDemoResourceRows,
  technicalNoStore,
  technicalRows,
  unauthorizedTechnicalResponse
} from "@/lib/technical-api";
import {
  isTechnicalResource,
  technicalResources,
  type TechnicalResourceDefinition
} from "@/lib/technical-resources";

export const dynamic = "force-dynamic";

const pageSize = 25;
const exportLimit = 5_000;

function cleanSearch(value: string): string {
  return value.replaceAll(/[^\p{L}\p{N}\s@.+_:/-]/gu, " ").trim().slice(0, 100);
}

function cleanFilter(value: string): string {
  return value.replaceAll(/[^\p{L}\p{N}_.:-]/gu, "").slice(0, 80);
}

function validDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function csvCell(value: unknown): string {
  const sanitized = sanitizeTechnicalValue(value);
  let text = "";
  if (typeof sanitized === "object" && sanitized !== null) text = JSON.stringify(sanitized);
  else text = scalar(sanitized);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>, definition: TechnicalResourceDefinition) {
  const keys = definition.columns.map((column) => column.key);
  return `\ufeff${[
    definition.columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))
  ].join("\r\n")}`;
}

function withPageFrequency(rows: Array<Record<string, unknown>>) {
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const key = [row.source, row.event_type, row.message].map(scalar).join("\u0000");
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    const key = [row.source, row.event_type, row.message].map(scalar).join("\u0000");
    return { ...row, frequency_on_page: occurrences.get(key) ?? 1 };
  });
}

function withJobDuration(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => {
    const startedAt = typeof row.locked_at === "string" ? new Date(row.locked_at).getTime() : new Date(scalar(row.created_at)).getTime();
    const endedAt = typeof row.completed_at === "string" ? new Date(row.completed_at).getTime() : Date.now();
    const durationMs = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
      ? Math.round(endedAt - startedAt)
      : null;
    return { ...row, duration_ms: durationMs };
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const resource = (await params).resource;
  if (!isTechnicalResource(resource)) {
    return NextResponse.json(
      { message: "Área técnica não encontrada." },
      { status: 404, headers: technicalNoStore }
    );
  }
  if (isAuthorizedTechnicalDemo(request)) {
    if (request.nextUrl.searchParams.get("format") === "csv") {
      return NextResponse.json(
        { message: "A exportação não está disponível no ambiente de demonstração." },
        { status: 403, headers: technicalNoStore }
      );
    }
    const items = technicalDemoResourceRows(resource);
    return NextResponse.json(
      { items, total: items.length, page: 1, pageSize },
      { headers: technicalNoStore }
    );
  }
  const auth = await authorizeTechnicalRequest(request);
  if (!auth) return unauthorizedTechnicalResponse();

  const definition = technicalResources[resource];
  const page = Math.max(1, Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1));
  const search = cleanSearch(request.nextUrl.searchParams.get("q") ?? "");
  const status = cleanFilter(request.nextUrl.searchParams.get("status") ?? "");
  const severity = cleanFilter(request.nextUrl.searchParams.get("severity") ?? "");
  const source = cleanFilter(request.nextUrl.searchParams.get("source") ?? "");
  const route = cleanSearch(request.nextUrl.searchParams.get("route") ?? "");
  const user = request.nextUrl.searchParams.get("user") ?? "";
  const requestId = request.nextUrl.searchParams.get("request") ?? "";
  const fromDate = validDate(request.nextUrl.searchParams.get("from") ?? "");
  const toDate = validDate(request.nextUrl.searchParams.get("to") ?? "");
  const format = request.nextUrl.searchParams.get("format");

  let query = auth.supabase
    .from(definition.table)
    .select(definition.select, { count: format === "csv" ? undefined : "exact" });

  if (search && definition.searchColumns.length) {
    query = query.or(definition.searchColumns.map((column) => `${column}.ilike.%${search}%`).join(","));
  }
  if (status && definition.statusColumn) {
    query = query.eq(definition.statusColumn, definition.statusColumn === "enabled" ? status === "true" : status);
  }
  if (severity && ["technical_events", "security_events"].includes(definition.table)) query = query.eq("severity", severity);
  if (source && definition.table === "technical_events") query = query.eq("source", source);
  if (route && definition.table === "technical_events") query = query.ilike("route", `%${route}%`);
  if (fromDate && definition.dateColumn) query = query.gte(definition.dateColumn, `${fromDate}T00:00:00-03:00`);
  if (toDate && definition.dateColumn) query = query.lt(definition.dateColumn, `${nextDate(toDate)}T00:00:00-03:00`);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user)) {
    if (definition.table === "security_events") query = query.eq("user_id", user);
    if (definition.table === "audit_logs") query = query.eq("actor_id", user);
    if (definition.table === "technical_events") query = query.eq("user_id", user);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) && ["technical_events", "security_events", "audit_logs"].includes(definition.table)) {
    query = query.eq("request_id", requestId);
  }
  if (resource === "erros") query = query.in("severity", ["error", "critical", "fatal"]);
  if (resource === "falhas") query = query.eq("status", "failed");
  if (resource === "acessos-tecnicos") query = query.or("actor_role.eq.technical,action.ilike.%access%,entity_type.in.(profiles,user_roles,user_permission_overrides)");
  if (resource === "auditoria-tecnica") query = query.or("actor_role.eq.technical,action.ilike.technical.%");
  if (resource === "performance") query = query.or("event_type.ilike.%performance%,event_type.ilike.%latency%,event_type.ilike.%slow%");

  query = query.order(definition.orderColumn, { ascending: false });

  if (format === "csv") {
    if (!definition.exportAllowed) {
      return NextResponse.json({ message: "Esta área não permite exportação." }, { status: 405, headers: technicalNoStore });
    }
    const permission = await auth.supabase.rpc("technical_can_export");
    const allowed: unknown = permission.data;
    if (permission.error || allowed !== true) {
      return NextResponse.json({ message: "Sua permissão não permite exportar logs." }, { status: 403, headers: technicalNoStore });
    }
    const result = await query.limit(exportLimit);
    if (result.error) {
      return NextResponse.json({ message: "Não foi possível exportar os registros." }, { status: 503, headers: technicalNoStore });
    }
    const audit = await auth.supabase.rpc("technical_log_export", {
      p_resource: resource,
      p_filters: {
        query_applied: Boolean(search),
        status: status || null,
        severity: severity || null,
        source: source || null,
        route: route || null,
        from: fromDate,
        to: toDate,
        user: user || null,
        request: requestId || null
      }
    });
    if (audit.error) {
      return NextResponse.json({ message: "A exportação foi bloqueada porque a auditoria falhou." }, { status: 503, headers: technicalNoStore });
    }
    return new NextResponse(toCsv(technicalRows(result.data), definition), {
      headers: {
        ...technicalNoStore,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${resource}.csv"`
      }
    });
  }

  const offset = (page - 1) * pageSize;
  const result = await query.range(offset, offset + pageSize - 1);
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os registros técnicos." },
      { status: 503, headers: technicalNoStore }
    );
  }
  const rows = technicalRows(result.data);
  const jobRows = ["filas", "jobs", "falhas"].includes(resource) ? withJobDuration(rows) : rows;
  const responseRows = resource === "erros" ? withPageFrequency(jobRows) : jobRows;
  return NextResponse.json(
    {
      items: responseRows.map((item) => sanitizeTechnicalValue(item)),
      total: result.count ?? 0,
      page,
      pageSize
    },
    { headers: technicalNoStore }
  );
}
