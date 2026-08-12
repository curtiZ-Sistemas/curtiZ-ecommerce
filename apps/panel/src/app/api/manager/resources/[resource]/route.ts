import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeManagerRequest,
  managerNoStore,
  managerRows,
  unauthorizedManagerResponse
} from "@/lib/manager-api";
import {
  isManagerResource,
  managerResources,
  type ManagerResourceDefinition
} from "@/lib/manager-resources";

export const dynamic = "force-dynamic";

const pageSize = 20;
const exportLimit = 5_000;

function cleanSearch(value: string): string {
  return value
    .replaceAll(/[^\p{L}\p{N}\s@.+-]/gu, " ")
    .trim()
    .slice(0, 80);
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

function csvCell(value: unknown): string {
  let text = "";
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else if (typeof value === "object" && value !== null) text = JSON.stringify(value);

  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>, definition: ManagerResourceDefinition) {
  const keys = definition.columns.map((column) => column.key);
  const header = definition.columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => keys.map((key) => csvCell(row[key])).join(","));
  return `\ufeff${[header, ...body].join("\r\n")}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const resource = (await params).resource;
  if (!isManagerResource(resource)) {
    return NextResponse.json(
      { message: "Área gerencial não encontrada." },
      { status: 404, headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const definition = managerResources[resource];
  const page = Math.max(
    1,
    Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1)
  );
  const search = cleanSearch(request.nextUrl.searchParams.get("q") ?? "");
  const requestedStatus = cleanFilter(request.nextUrl.searchParams.get("status") ?? "");
  const status = definition.fixedStatus ?? requestedStatus;
  const fromDate = validDate(request.nextUrl.searchParams.get("from") ?? "");
  const toDate = validDate(request.nextUrl.searchParams.get("to") ?? "");
  const format = request.nextUrl.searchParams.get("format");
  const auditActor = request.nextUrl.searchParams.get("actor") ?? "";
  const auditAction = cleanFilter(request.nextUrl.searchParams.get("action") ?? "");
  const auditModule = cleanFilter(request.nextUrl.searchParams.get("module") ?? "");
  const auditResult = cleanFilter(request.nextUrl.searchParams.get("result") ?? "");

  let query = auth.supabase
    .from(definition.table)
    .select(definition.select, { count: format === "csv" ? undefined : "exact" });

  if (search && definition.searchColumns.length) {
    query = query.or(
      definition.searchColumns.map((column) => `${column}.ilike.%${search}%`).join(",")
    );
  }
  if (status && definition.statusColumn) query = query.eq(definition.statusColumn, status);
  if (fromDate && definition.dateColumn) {
    query = query.gte(definition.dateColumn, `${fromDate}T00:00:00-03:00`);
  }
  if (toDate && definition.dateColumn) {
    query = query.lt(definition.dateColumn, `${nextDate(toDate)}T00:00:00-03:00`);
  }
  if (resource === "auditoria") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditActor)) {
      query = query.eq("actor_id", auditActor);
    }
    if (auditAction) query = query.eq("action", auditAction);
    if (auditModule) query = query.eq("entity_type", auditModule);
    if (auditResult) query = query.contains("new_data_sanitized", { result: auditResult });
  }

  query = query.order(definition.orderColumn, { ascending: false });

  if (format === "csv") {
    if (!definition.exportAllowed) {
      return NextResponse.json(
        { message: "Esta área não permite exportação." },
        { status: 405, headers: managerNoStore }
      );
    }

    const exportPermission = await auth.supabase.rpc("manager_can_export");
    const canExport: unknown = exportPermission.data;
    if (exportPermission.error || canExport !== true) {
      return NextResponse.json(
        { message: "Sua permissão não permite exportar relatórios." },
        { status: 403, headers: managerNoStore }
      );
    }

    const result = await query.limit(exportLimit);
    if (result.error) {
      return NextResponse.json(
        { message: "Não foi possível exportar os dados." },
        { status: 503, headers: managerNoStore }
      );
    }

    const audit = await auth.supabase.rpc("manager_log_export", {
      p_resource: resource,
      p_filters: {
        status: status || null,
        from: fromDate,
        to: toDate,
        query_applied: Boolean(search),
        actor: auditActor || null,
        action: auditAction || null,
        module: auditModule || null,
        result: auditResult || null
      }
    });
    if (audit.error) {
      return NextResponse.json(
        { message: "A exportação não foi liberada porque a auditoria falhou." },
        { status: 503, headers: managerNoStore }
      );
    }

    return new NextResponse(
      toCsv(managerRows(result.data), definition),
      {
        headers: {
          ...managerNoStore,
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${resource}.csv"`
        }
      }
    );
  }

  const offset = (page - 1) * pageSize;
  const result = await query.range(offset, offset + pageSize - 1);
  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os registros desta área." },
      { status: 503, headers: managerNoStore }
    );
  }

  const [canExport, canManageClosings, canManageRepresentatives, canManageCreatives, canApproveCreatives, canPublishCreatives] =
    await Promise.all([
      auth.supabase.rpc("has_permission", { permission_code: "reports.export" }),
      auth.supabase.rpc("has_permission", { permission_code: "representatives.commissions.close" }),
      auth.supabase.rpc("has_permission", { permission_code: "representatives.manage" }),
      auth.supabase.rpc("has_permission", { permission_code: "creatives.manage" }),
      auth.supabase.rpc("has_permission", { permission_code: "creatives.approve" }),
      auth.supabase.rpc("has_permission", { permission_code: "creatives.publish" })
    ]);

  return NextResponse.json(
    {
      items: result.data ?? [],
      total: result.count ?? 0,
      page,
      pageSize,
      capabilities: {
        export: definition.exportAllowed && canExport.data === true && !canExport.error,
        manageClosings: canManageClosings.data === true && !canManageClosings.error,
        manageRepresentatives: canManageRepresentatives.data === true && !canManageRepresentatives.error,
        manageCreatives: canManageCreatives.data === true && !canManageCreatives.error,
        approveCreatives: canApproveCreatives.data === true && !canApproveCreatives.error,
        publishCreatives: canPublishCreatives.data === true && !canPublishCreatives.error
      }
    },
    { headers: managerNoStore }
  );
}
