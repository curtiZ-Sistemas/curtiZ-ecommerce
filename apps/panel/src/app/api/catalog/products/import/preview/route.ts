import { readFormResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, objectRows, privateNoStore, safePanelOrigin, unauthorizedAdminResponse } from "@/lib/admin-api";
import { PRODUCT_IMPORT_MAX_BYTES, parseProductImportWorkbook, productImportPreview } from "@/lib/product-import";

export const runtime = "nodejs";

const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? `${value}` : "";
const normalized = (value: unknown) => text(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");

export async function POST(request: NextRequest) {
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
  try {
    const batch = await parseProductImportWorkbook(await file.arrayBuffer());
    const [categories, models, collections, imported] = await Promise.all([
      auth.supabase.from("categories").select("id,name"),
      auth.supabase.from("product_models").select("id,name"),
      auth.supabase.from("collections").select("id,name"),
      auth.supabase.from("product_import_sources").select("source,external_key,product_id")
        .in("external_key", batch.products.map((product) => product.shopeeId || product.key))
    ]);
    if (categories.error || models.error || collections.error || imported.error) {
      return NextResponse.json({ message: "A importação ainda não está sincronizada com o banco." }, { status: 503, headers: privateNoStore });
    }
    const categoryNames = new Set(objectRows(categories.data).map((item) => normalized(item.name)).filter(Boolean));
    const modelNames = new Set(objectRows(models.data).map((item) => normalized(item.name)).filter(Boolean));
    const collectionNames = new Set(objectRows(collections.data).map((item) => normalized(item.name)).filter(Boolean));
    const importedKeys = new Set(objectRows(imported.data).map((item) => `${normalized(item.source)}:${text(item.external_key)}`));
    for (const product of batch.products) {
      if (!categoryNames.has(normalized(product.categoryName))) product.issues.push({ level: "error", code: "CATEGORY_NOT_FOUND", message: `Categoria não encontrada: ${product.categoryName}.`, productKey: product.key });
      if (product.modelName && !modelNames.has(normalized(product.modelName))) product.issues.push({ level: "error", code: "MODEL_NOT_FOUND", message: `Modelo não encontrado: ${product.modelName}.`, productKey: product.key });
      if (product.collectionName && !collectionNames.has(normalized(product.collectionName))) product.issues.push({ level: "error", code: "COLLECTION_NOT_FOUND", message: `Coleção não encontrada: ${product.collectionName}.`, productKey: product.key });
    }
    const preview = productImportPreview(batch);
    return NextResponse.json({
      ...preview,
      products: preview.products.map((product) => {
        const source = batch.products.find((item) => item.key === product.key)!;
        return { ...product, alreadyImported: importedKeys.has(`${normalized(source.source)}:${source.shopeeId || source.key}`) };
      })
    }, { headers: privateNoStore });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Planilha inválida." }, { status: 400, headers: privateNoStore });
  }
}
