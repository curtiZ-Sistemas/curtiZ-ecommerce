import { logServerEvent } from "@curtiz/security";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { deleteMyMercadoPagoCard, listMyMercadoPagoCards, saveMyMercadoPagoCard, savedCardsEnabled, SavedCardsError } from "@/lib/mercadopago-saved-cards";
import { PrivateRequestError, readPrivateJson } from "@/lib/private-request";

export const dynamic = "force-dynamic";
const save = z.object({ orderId: z.string().uuid(), key: z.string().uuid(), token: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/u), consent: z.literal(true) }).strict();
const remove = z.object({ cardId: z.string().regex(/^[a-zA-Z0-9_+-]{1,100}$/u) }).strict();
async function handle(request: Request, operation: "list" | "save" | "delete") {
  const requestId = crypto.randomUUID();
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
    status, headers: { "cache-control": "private, no-store", "x-request-id": requestId }
  });
  try {
    const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
    if (crossSite || !isAllowedRequestOrigin(request) || (operation !== "list" &&
      (request.headers.get("origin") !== new URL(request.url).origin ||
        !request.headers.get("content-type")?.startsWith("application/json")))) return reply({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida." }, 403);
    const auth = await createServerSupabaseClient();
    const result = auth ? await auth.auth.getUser() : null;
    if (result?.error || !result?.data.user) return reply({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Entre na sua conta para continuar." }, 401);
    if (!savedCardsEnabled()) return operation === "list"
      ? reply({ ok: true, enabled: false, customerId: "", cards: [] })
      : reply({ ok: false, code: "SAVED_CARDS_UNAVAILABLE", message: "Cartões salvos não estão disponíveis agora." }, 503);
    const db = createServiceSupabaseClient();
    if (!db) throw new SavedCardsError("SAVED_CARDS_UNAVAILABLE");
    const rate = await db.rpc("enforce_mercadopago_card_rate_limit", { p_user_id: result.data.user.id });
    if (rate.error || rate.data !== true) return reply({ ok: false, code: "RATE_LIMITED", message: "Aguarde um momento e tente novamente." }, 429);
    const user = result.data.user;
    if (operation === "list") return reply({ ok: true, ...await listMyMercadoPagoCards(db, user) });
    let body: unknown;
    try { body = await readPrivateJson(request, 4 * 1024); }
    catch (error) { return reply({ ok: false, code: error instanceof PrivateRequestError && error.status === 413
      ? "REQUEST_TOO_LARGE" : "INVALID_CARD_REQUEST", message: "Dados do cartão inválidos." },
      error instanceof PrivateRequestError ? error.status : 400); }
    if (operation === "save") {
      const parsed = save.safeParse(body);
      if (!parsed.success) return reply({ ok: false, code: "INVALID_CARD_REQUEST", message: "Confirme os dados e sua opção de salvar o cartão." }, 400);
      await saveMyMercadoPagoCard(db, user, parsed.data);
    } else {
      const parsed = remove.safeParse(body);
      if (!parsed.success) return reply({ ok: false, code: "INVALID_CARD_REQUEST", message: "Cartão inválido." }, 400);
      await deleteMyMercadoPagoCard(db, user, parsed.data.cardId, requestId);
    }
    return reply({ ok: true });
  } catch (error) {
    const code = error instanceof SavedCardsError ? error.code : "SAVED_CARDS_UNAVAILABLE";
    // Never log provider payload, tokens, personal identity or error.message from the SDK.
    logServerEvent("error", "mercadopago_cards_operation_failed", { operation, code, requestId });
    return reply({ ok: false, code, message: "Não foi possível atualizar seus cartões. Seu pagamento permanece seguro." },
      error instanceof SavedCardsError ? error.status : 503);
  }
}
export const GET = (request: Request) => handle(request, "list");
export const POST = (request: Request) => handle(request, "save");
export const DELETE = (request: Request) => handle(request, "delete");
