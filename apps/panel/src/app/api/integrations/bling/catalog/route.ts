import { type NextRequest, NextResponse } from "next/server";
import { authorizeBlingPanelRequest } from "@/lib/bling-server";
import { safeTechnicalOrigin, technicalNoStore } from "@/lib/technical-api";
import { consumePanelMutationBudget } from "@/lib/api-rate-limit";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: technicalNoStore });

export async function GET(request: NextRequest) {
  const db = await authorizeBlingPanelRequest(request);
  if (!db) return reply({ message: "Acesso negado." }, 403);
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId || !uuid.test(productId)) return reply({ message: "Produto inválido." }, 400);
  const result = await db.rpc("list_bling_catalog_states", { p_product_id: productId });
  if (result.error) return reply({ message: "Consulta indisponível ou sem permissão." }, 503);
  const variants: unknown = result.data;
  return reply({ variants: Array.isArray(variants) ? variants : [] });
}

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return reply({ message: "Origem não permitida." }, 403);
  const db = await authorizeBlingPanelRequest(request);
  if (!db) return reply({ message: "Acesso negado." }, 403);
  if (!await consumePanelMutationBudget(request, db)) return reply({ message: "Tente novamente em instantes." }, 429);
  const body: unknown = await request.json().catch(() => null);
  const variantId = body && typeof body === "object" && "variantId" in body ? body.variantId : null;
  const action = body && typeof body === "object" && "action" in body ? body.action : "retry";
  if (typeof variantId !== "string" || !uuid.test(variantId) || action !== "retry" && action !== "reconcile") return reply({ message: "Variante inválida." }, 400);
  const result = await db.rpc(action === "reconcile" ? "enqueue_bling_product_reconciliation" : "retry_bling_catalog_sync", { p_variant_id: variantId });
  if (result.error || result.data !== true) return reply({ message: "Revise o vínculo e o estado externo antes de repetir." }, 409);
  return reply({ message: "Sincronização solicitada." });
}
