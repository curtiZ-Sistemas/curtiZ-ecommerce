import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import {
  adminResources,
  isAdminResource,
  type AdminResourceDefinition
} from "@/lib/admin-resources";

export const dynamic = "force-dynamic";

const mutationSchema = z.object({
  id: z.string().uuid().optional(),
  values: z.record(z.string(), z.unknown()).default({})
});

const stateActionSchema = z.object({
  action: z.enum(["archive", "restore"]),
  ids: z.array(z.string().uuid()).min(1).max(100)
});

function cleanSearch(value: string): string {
  return value
    .replaceAll(/[^\p{L}\p{N}\s@.+-]/gu, " ")
    .trim()
    .slice(0, 80);
}

function primitiveToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeValues(
  definition: AdminResourceDefinition,
  input: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const field of definition.fields) {
    if (field.readOnly || !(field.key in input)) continue;

    const value = input[field.key];

    if (field.type === "boolean") {
      normalized[field.key] = value === true || value === "true";
      continue;
    }

    if (field.type === "number") {
      if (value === "" || value === null || value === undefined) {
        normalized[field.key] = null;
        continue;
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Campo inválido: ${field.label}`);
      }

      normalized[field.key] = parsed;
      continue;
    }

    if (field.type === "json") {
      if (value === "" || value === null || value === undefined) {
        normalized[field.key] = null;
        continue;
      }

      if (typeof value === "object") {
        normalized[field.key] = value;
        continue;
      }

      const jsonText = primitiveToString(value);
      if (jsonText === null) {
        throw new Error(`Campo inválido: ${field.label}`);
      }

      try {
        const parsedJson: unknown = JSON.parse(jsonText);
        normalized[field.key] = parsedJson;
      } catch {
        throw new Error(`Campo inválido: ${field.label}`);
      }

      continue;
    }

    if (value === null || value === undefined || value === "") {
      normalized[field.key] = null;
      continue;
    }

    const rawText = primitiveToString(value);
    if (rawText === null) {
      throw new Error(`Campo inválido: ${field.label}`);
    }

    const text = rawText.trim();

    if (text.length > 4_000) {
      throw new Error(`Campo muito extenso: ${field.label}`);
    }

    if (field.options && !field.options.includes(text)) {
      throw new Error(`Opção inválida: ${field.label}`);
    }

    if (field.type === "datetime" && text) {
      const date = new Date(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? `${text}:00-03:00` : text
      );
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Campo inválido: ${field.label}`);
      }
      normalized[field.key] = date.toISOString();
      continue;
    }

    normalized[field.key] = text;
  }

  for (const field of definition.fields) {
    if (!field.required) continue;

    const value = normalized[field.key];
    if (value === null || value === undefined || value === "") {
      throw new Error(`Preencha o campo ${field.label}.`);
    }
  }

  return normalized;
}

function validateResourceRules(resource: string, values: Record<string, unknown>): void {
  if (resource === "metas") {
    const hasRepresentative = typeof values.representative_id === "string";
    const hasLevel = typeof values.level_id === "string";

    if (hasRepresentative === hasLevel) {
      throw new Error("Escolha um representante ou um nível para a meta.");
    }
  }

  if (
    resource === "criativos" &&
    typeof values.storage_path !== "string" &&
    typeof values.caption_text !== "string"
  ) {
    throw new Error("Informe um arquivo ou o texto do criativo.");
  }
}

async function resourceContext(
  request: NextRequest,
  params: Promise<{ resource: string }>
) {
  const resource = (await params).resource;
  if (!isAdminResource(resource)) return null;

  const managerResources = new Set([
    "pagina-inicial",
    "banners",
    "niveis",
    "metas",
    "kits",
    "comissoes"
  ]);
  const auth = await authorizeAdminRequest(
    request,
    managerResources.has(resource) ? ["admin", "manager"] : ["admin"]
  );
  if (!auth) {
    return {
      resource,
      definition: adminResources[resource],
      auth: null
    };
  }

  return {
    resource,
    definition: adminResources[resource],
    auth
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const context = await resourceContext(request, params);

  if (!context) {
    return NextResponse.json(
      { message: "Área administrativa não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  }

  if (!context.auth) return unauthorizedAdminResponse();

  const page = Math.max(
    1,
    Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1)
  );
  const pageSize = 20;
  const queryText = cleanSearch(request.nextUrl.searchParams.get("q") ?? "");
  const status = (request.nextUrl.searchParams.get("status") ?? "").slice(0, 40);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = context.auth.supabase
    .from(context.definition.table)
    .select(context.definition.select, { count: "exact" });

  if (queryText && context.definition.searchColumns.length) {
    query = query.or(
      context.definition.searchColumns
        .map((column) => `${column}.ilike.%${queryText}%`)
        .join(",")
    );
  }

  if (status) {
    const statusField = context.definition.fields.find(
      (field) => field.key === "status" || field.key === "active"
    );

    if (statusField) {
      query = query.eq(
        statusField.key,
        statusField.type === "boolean" ? status === "active" : status
      );
    }
  }

  const result = await query
    .order(context.definition.orderColumn, { ascending: false })
    .range(from, to);

  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar os registros desta área." },
      { status: 503, headers: privateNoStore }
    );
  }

  return NextResponse.json(
    {
      items: result.data ?? [],
      total: result.count ?? 0,
      page,
      pageSize
    },
    { headers: privateNoStore }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }

  const context = await resourceContext(request, params);

  if (!context) {
    return NextResponse.json(
      { message: "Área não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  }

  if (!context.auth) return unauthorizedAdminResponse();

  if (!context.definition.allowCreate) {
    return NextResponse.json(
      { message: "Novos registros não são criados por esta área." },
      { status: 405, headers: privateNoStore }
    );
  }

  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise os dados informados." },
      { status: 400, headers: privateNoStore }
    );
  }

  try {
    const values = normalizeValues(context.definition, parsed.data.values);
    validateResourceRules(context.resource, values);

    if (context.definition.createdByField) {
      values[context.definition.createdByField] = context.auth.userId;
    }

    if (context.definition.updatedByField) {
      values[context.definition.updatedByField] = context.auth.userId;
    }

    const result = await context.auth.supabase
      .from(context.definition.table)
      .insert(values)
      .select(context.definition.select)
      .single();

    if (result.error) throw result.error;

    return NextResponse.json(
      {
        item: result.data,
        message: `${context.definition.singular} criada com sucesso.`
      },
      { status: 201, headers: privateNoStore }
    );
  } catch (error) {
    const validationMessage =
      error instanceof Error &&
      ["Preencha", "Escolha", "Informe", "Campo", "Opção"].some((prefix) =>
        error.message.startsWith(prefix)
      )
        ? error.message
        : null;

    const message =
      validationMessage ?? `Não foi possível criar ${context.definition.singular}.`;

    return NextResponse.json(
      { message },
      { status: 409, headers: privateNoStore }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }

  const context = await resourceContext(request, params);

  if (!context) {
    return NextResponse.json(
      { message: "Área não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  }

  if (!context.auth) return unauthorizedAdminResponse();

  const body: unknown = await request.json().catch(() => null);
  const stateAction = stateActionSchema.safeParse(body);

  if (stateAction.success) {
    const targetValue =
      stateAction.data.action === "archive"
        ? context.definition.archiveValue
        : context.definition.restoreValue;

    if (
      !context.definition.allowArchive ||
      !context.definition.archiveField ||
      targetValue === undefined
    ) {
      return NextResponse.json(
        { message: "Esta área preserva o estado dos registros por integridade histórica." },
        { status: 405, headers: privateNoStore }
      );
    }

    const values: Record<string, unknown> = {
      [context.definition.archiveField]: targetValue
    };

    if (context.definition.updatedByField) {
      values[context.definition.updatedByField] = context.auth.userId;
    }

    const result = await context.auth.supabase
      .from(context.definition.table)
      .update(values)
      .in("id", stateAction.data.ids)
      .select("id");

    if (result.error || !result.data?.length) {
      return NextResponse.json(
        { message: "Não foi possível atualizar os registros selecionados." },
        { status: 409, headers: privateNoStore }
      );
    }

    const actionLabel = stateAction.data.action === "archive" ? "arquivado" : "restaurado";
    return NextResponse.json(
      {
        message:
          result.data.length === 1
            ? `Registro ${actionLabel}.`
            : `${result.data.length} registros foram atualizados.`
      },
      { headers: privateNoStore }
    );
  }

  const parsed = mutationSchema
    .extend({ id: z.string().uuid() })
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Revise os dados informados." },
      { status: 400, headers: privateNoStore }
    );
  }

  try {
    const values = normalizeValues(context.definition, parsed.data.values);
    validateResourceRules(context.resource, values);

    if (context.definition.updatedByField) {
      values[context.definition.updatedByField] = context.auth.userId;
    }

    const result = await context.auth.supabase
      .from(context.definition.table)
      .update(values)
      .eq("id", parsed.data.id)
      .select(context.definition.select)
      .maybeSingle();

    if (result.error || !result.data) {
      throw result.error ?? new Error("missing");
    }

    return NextResponse.json(
      { item: result.data, message: "Alterações salvas." },
      { headers: privateNoStore }
    );
  } catch (error) {
    const validationMessage =
      error instanceof Error &&
      ["Preencha", "Escolha", "Informe", "Campo", "Opção"].some((prefix) =>
        error.message.startsWith(prefix)
      )
        ? error.message
        : null;

    return NextResponse.json(
      { message: validationMessage ?? "Não foi possível salvar as alterações." },
      { status: 409, headers: privateNoStore }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  }

  const context = await resourceContext(request, params);

  if (!context) {
    return NextResponse.json(
      { message: "Área não encontrada." },
      { status: 404, headers: privateNoStore }
    );
  }

  if (!context.auth) return unauthorizedAdminResponse();

  if (
    !context.definition.allowArchive ||
    !context.definition.archiveField ||
    context.definition.archiveValue === undefined
  ) {
    return NextResponse.json(
      { message: "Este registro deve ser mantido por integridade histórica." },
      { status: 405, headers: privateNoStore }
    );
  }

  const parsed = z
    .object({ id: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Registro inválido." },
      { status: 400, headers: privateNoStore }
    );
  }

  const values: Record<string, unknown> = {
    [context.definition.archiveField]: context.definition.archiveValue
  };

  if (context.definition.updatedByField) {
    values[context.definition.updatedByField] = context.auth.userId;
  }

  const result = await context.auth.supabase
    .from(context.definition.table)
    .update(values)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) {
    return NextResponse.json(
      { message: "Não foi possível arquivar o registro." },
      { status: 409, headers: privateNoStore }
    );
  }

  return NextResponse.json(
    { message: "Registro arquivado." },
    { headers: privateNoStore }
  );
}
