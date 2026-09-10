import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createPublicSupabaseClient, createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit";
import { deletionToken, validDeletionToken } from "@/lib/account-deletion-token";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), password: z.string().min(1).max(256) }),
  z.object({ action: z.literal("confirm"), token: z.string().max(100), confirmed: z.literal(true) })
]);
const headers = { "cache-control": "private, no-store" };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers });

async function handleDeletion(request: Request) {
  if (!isAllowedRequestOrigin(request)) return reply("Origem não autorizada.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply("Confira os dados informados.", 400);
  const supabase = await createServerSupabaseClient();
  const service = createServiceSupabaseClient();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabase || !service || !secret) return reply("A exclusão está temporariamente indisponível.", 503);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return reply("Entre novamente para continuar.", 401);
  const roles = await service.from("user_roles").select("role").eq("user_id", user.id);
  if (roles.error) return reply("Não conseguimos verificar sua conta.", 503);
  if (!roles.data?.length || roles.data.some((entry) => entry.role !== "customer")) {
    return reply("Contas com acesso a painéis precisam ser encerradas pela administração.", 403);
  }
  if (parsed.data.action === "verify") {
    if (!await enforceAuthRateLimit({ request, email: user.email, scope: "login", supabase })) {
      return reply("Muitas tentativas. Aguarde antes de tentar novamente.", 429);
    }
    const verifier = createPublicSupabaseClient();
    if (!verifier) return reply("Não conseguimos verificar a senha.", 503);
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password: parsed.data.password });
    if (verified.error || verified.data.user?.id !== user.id) return reply("Confira sua senha. A conta não foi excluída.", 403);
    await verifier.auth.signOut({ scope: "local" });
    return NextResponse.json({ token: deletionToken(user.id, secret) }, { headers });
  }
  if (!validDeletionToken(parsed.data.token, user.id, secret)) return reply("A confirmação expirou. Informe sua senha novamente.", 403);
  // A transação preserva vínculos de pedidos, mas remove os dados do perfil e o carrinho.
  // É idempotente para permitir nova tentativa se o provedor de autenticação falhar.
  const cleanup = await service.rpc("close_customer_account", { p_user_id: user.id });
  if (cleanup.error) return reply("Não conseguimos concluir a exclusão. Tente novamente.", 503);
  const removed = await service.auth.admin.deleteUser(user.id, true);
  if (removed.error) return reply("Seu perfil foi desativado e o carrinho foi limpo, mas falta concluir a exclusão do acesso. Tente confirmar novamente.", 503);
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true }, { headers });
}

export async function POST(request: Request) {
  try { return await handleDeletion(request); }
  catch { return reply("Não conseguimos confirmar a operação. Tente novamente.", 503); }
}
