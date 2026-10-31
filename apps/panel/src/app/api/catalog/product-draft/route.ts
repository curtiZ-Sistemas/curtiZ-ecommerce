import { logServerEvent } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import {
  authorizeAdminRequest,
  privateNoStore,
  readPanelJson,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { panelRateLimitFailure } from "../../../../lib/api-rate-limit";
import {
  newProductDraftSchema,
  PRODUCT_DRAFT_MAX_BYTES
} from "@/lib/product-draft";

export const dynamic = "force-dynamic";

type DraftError = { code?: string; message?: string; details?: string } | null;

function logDraftFailure(operation: string, error: DraftError, requestId: string) {
  logServerEvent("error", "panel_product_draft_operation_failed", {
    requestId,
    operation,
    code: error?.code?.slice(0, 40) ?? "unknown",
    message: error?.message?.slice(0, 180) ?? "unknown",
    details: error?.details?.slice(0, 180)
  });
}

function logDraftValidationFailure(
  requestId: string,
  issues: Array<{ code: string; path: PropertyKey[] }>
) {
  logServerEvent("warn", "panel_product_draft_validation_failed", {
    requestId,
    issues: issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map(String).join(".")
    }))
  });
}

async function authorizeDraft(request: NextRequest, requestId: string) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) {
    const failure = panelRateLimitFailure(request);
    if (failure?.status === 503) {
      logDraftFailure("consume_private_api_rate_limit", failure, requestId);
    }
    return null;
  }
  const [createPermission, updatePermission] = await Promise.all([
    auth.supabase.rpc("has_permission", { permission_code: "products.create" }),
    auth.supabase.rpc("has_permission", { permission_code: "products.update" })
  ]);
  const error = createPermission.error ?? updatePermission.error;
  if (error) {
    logDraftFailure("authorize_product_draft", error, requestId);
    return null;
  }
  return createPermission.data === true && updatePermission.data === true ? auth : null;
}

const forbiddenOrigin = () => NextResponse.json(
  { message: "Origem não permitida." },
  { status: 403, headers: privateNoStore }
);

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return forbiddenOrigin();
  const auth = await authorizeDraft(request, requestId);
  if (!auth) return unauthorizedAdminResponse(request);

  const result = await auth.supabase
    .from("product_editor_drafts")
    .select("schema_version,payload,saved_at,updated_at")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (result.error) {
    logDraftFailure("load_product_draft", result.error, requestId);
    return NextResponse.json(
      { message: "Não foi possível consultar o rascunho agora.", requestId },
      { status: 503, headers: privateNoStore }
    );
  }
  if (!result.data) {
    return NextResponse.json({ ok: true, draft: null }, { headers: privateNoStore });
  }
  const parsed = newProductDraftSchema.safeParse(result.data.payload);
  if (!parsed.success || result.data.schema_version !== parsed.data.schemaVersion) {
    logDraftFailure("validate_stored_product_draft", { code: "INVALID_STORED_DRAFT" }, requestId);
    return NextResponse.json(
      { message: "O rascunho armazenado não é compatível com este editor.", requestId },
      { status: 409, headers: privateNoStore }
    );
  }
  const updatedAt: unknown = result.data.updated_at;
  return NextResponse.json(
    { ok: true, draft: parsed.data, updatedAt: typeof updatedAt === "string" ? updatedAt : null },
    { headers: privateNoStore }
  );
}

export async function PUT(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return forbiddenOrigin();
  const body = await readPanelJson(request, PRODUCT_DRAFT_MAX_BYTES);
  if (body instanceof Response) return body;
  const parsed = newProductDraftSchema.safeParse(body);
  if (!parsed.success) {
    logDraftValidationFailure(requestId, parsed.error.issues);
    return NextResponse.json(
      { message: "O rascunho possui dados inválidos ou excede os limites permitidos.", requestId },
      { status: 400, headers: privateNoStore }
    );
  }
  const auth = await authorizeDraft(request, requestId);
  if (!auth) return unauthorizedAdminResponse(request);

  const result = await auth.supabase.rpc("save_product_editor_draft", {
    p_schema_version: parsed.data.schemaVersion,
    p_payload: parsed.data,
    p_saved_at: parsed.data.savedAt
  });
  if (result.error) {
    logDraftFailure("save_product_editor_draft", result.error, requestId);
    return NextResponse.json(
      { message: "O rascunho foi mantido neste dispositivo, mas ainda não sincronizou.", requestId },
      { status: 503, headers: privateNoStore }
    );
  }
  const savedAt: unknown = result.data;
  if (typeof savedAt !== "string") {
    logDraftFailure("save_product_editor_draft", { code: "INVALID_DRAFT_SAVE_RESULT" }, requestId);
    return NextResponse.json(
      { message: "Não foi possível confirmar a sincronização do rascunho.", requestId },
      { status: 503, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { ok: true, savedAt },
    { headers: privateNoStore }
  );
}

export async function DELETE(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return forbiddenOrigin();
  const auth = await authorizeDraft(request, requestId);
  if (!auth) return unauthorizedAdminResponse(request);

  const result = await auth.supabase
    .from("product_editor_drafts")
    .delete()
    .eq("user_id", auth.userId);
  if (result.error) {
    logDraftFailure("delete_product_draft", result.error, requestId);
    return NextResponse.json(
      { message: "Não foi possível descartar o rascunho agora.", requestId },
      { status: 503, headers: privateNoStore }
    );
  }
  return NextResponse.json({ ok: true }, { headers: privateNoStore });
}
