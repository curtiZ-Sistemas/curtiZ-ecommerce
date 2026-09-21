import { createHash } from "node:crypto";
import { logServerEvent, postgresUuidSchema, readFormResponse, readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { PRODUCT_IMPORT_MAX_BYTES, parseProductImportWorkbook, productImportPreview, type ProductImportReference } from "@/lib/product-import";

export const runtime = "nodejs";

const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? `${value}` : "";
const normalized = (value: unknown) => text(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
const deleteSchema = z.object({ sessionId: postgresUuidSchema }).strict();

async function authorized(request: NextRequest) {
  if (!safePanelOrigin(request)) return null;
  const auth = await authorizeAdminRequest(request);
  if (!auth) return null;
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) =>
    auth.supabase.rpc("has_permission", { permission_code: permissionCode })
  ));
  return permissions.some((permission) => permission.error || permission.data !== true) ? null : auth;
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!safePanelOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const permissions = await Promise.all(["products.create", "products.update", "inventory.adjust"].map((permissionCode) =>
    auth.supabase.rpc("has_permission", { permission_code: permissionCode })
  ));
  if (permissions.some((permission) => permission.error || permission.data !== true)) {
    return NextResponse.json({ message: "Seu acesso não permite importar produtos." }, { status: 403, headers: privateNoStore });
  }
  const form = await readFormResponse(request, PRODUCT_IMPORT_MAX_BYTES + 65_536);
  if (form instanceof Response) return form;
  const file = form?.get("file");
  if (!(file instanceof File) || !file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx") || file.size < 1 || file.size > PRODUCT_IMPORT_MAX_BYTES) {
    return NextResponse.json({ message: "Selecione um arquivo XLSX de até 5 MB." }, { status: 400, headers: privateNoStore });
  }

  let stage: "parse" | "references" | "session" = "parse";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const batch = await parseProductImportWorkbook(bytes);
    stage = "references";
    const [categories, models, collections, imported] = await Promise.all([
      auth.supabase.from("categories").select("id,name"),
      auth.supabase.from("product_models").select("id,name"),
      auth.supabase.from("collections").select("id,name"),
      auth.supabase.from("product_import_sources").select("source,external_key,product_id")
        .in("external_key", batch.products.map((product) => product.shopeeId || product.key))
    ]);
    if (categories.error || models.error || collections.error || imported.error) throw new Error("CATALOG_REFERENCE_LOOKUP_FAILED");

    const categoryByName = new Map(objectRows(categories.data).map((item) => [normalized(item.name), text(item.id)]));
    const modelByName = new Map(objectRows(models.data).map((item) => [normalized(item.name), text(item.id)]));
    const collectionByName = new Map(objectRows(collections.data).map((item) => [normalized(item.name), text(item.id)]));
    const importedKeys = new Set(objectRows(imported.data).map((item) => `${normalized(item.source)}:${text(item.external_key)}`));
    const references: Record<string, ProductImportReference> = {};
    for (const product of batch.products) {
      const categoryId = categoryByName.get(normalized(product.categoryName)) || null;
      const modelId = product.modelName ? modelByName.get(normalized(product.modelName)) || null : null;
      const collectionId = product.collectionName ? collectionByName.get(normalized(product.collectionName)) || null : null;
      references[product.key] = { categoryId, modelId, collectionId };
      if (!categoryId) product.issues.push({ level: "error", code: "CATEGORY_NOT_FOUND", message: `Categoria não encontrada: ${product.categoryName}.`, productKey: product.key });
      if (product.modelName && !modelId) product.issues.push({ level: "error", code: "MODEL_NOT_FOUND", message: `Modelo não encontrado: ${product.modelName}.`, productKey: product.key });
      if (product.collectionName && !collectionId) product.issues.push({ level: "error", code: "COLLECTION_NOT_FOUND", message: `Coleção não encontrada: ${product.collectionName}.`, productKey: product.key });
    }

    stage = "session";
    await auth.supabase.from("product_import_sessions").delete().eq("user_id", auth.userId).lt("expires_at", new Date().toISOString());
    const session = await auth.supabase.from("product_import_sessions").insert({
      user_id: auth.userId,
      schema_version: batch.schemaVersion,
      batch_hash: createHash("sha256").update(bytes).digest("hex"),
      payload: { batch, references },
      expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString()
    }).select("id").single();
    const sessionId = text(session.data?.id);
    if (session.error || !sessionId) {
      logServerEvent("error", "panel_product_import_preview_failed", { requestId, stage, code: session.error?.code ?? "INVALID_SESSION_RESULT" });
      return NextResponse.json({ message: "A migration de sessões do importador ainda não está disponível no banco.", requestId }, { status: 503, headers: privateNoStore });
    }

    const preview = productImportPreview(batch);
    return NextResponse.json({
      ...preview,
      sessionId,
      products: preview.products.map((product) => {
        const source = batch.products.find((item) => item.key === product.key)!;
        return { ...product, alreadyImported: importedKeys.has(`${normalized(source.source)}:${source.shopeeId || source.key}`) };
      })
    }, { headers: privateNoStore });
  } catch (error) {
    logServerEvent("error", "panel_product_import_preview_failed", { requestId, stage, code: error instanceof Error ? error.message.slice(0, 80) : "unknown" });
    return NextResponse.json({
      message: stage === "parse" && error instanceof Error ? error.message : stage === "references"
        ? "Não foi possível validar as referências do catálogo."
        : "Não foi possível preparar a sessão de importação.",
      requestId
    }, { status: stage === "parse" ? 400 : 503, headers: privateNoStore });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorized(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const body = await readJsonResponse(request, 4_096);
  if (body instanceof Response) return body;
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "Sessão inválida." }, { status: 400, headers: privateNoStore });
  const removed = await auth.supabase.from("product_import_sessions").delete()
    .eq("id", parsed.data.sessionId).eq("user_id", auth.userId);
  if (removed.error) return NextResponse.json({ message: "Não foi possível encerrar a sessão." }, { status: 503, headers: privateNoStore });
  return NextResponse.json({ ok: true }, { headers: privateNoStore });
}
