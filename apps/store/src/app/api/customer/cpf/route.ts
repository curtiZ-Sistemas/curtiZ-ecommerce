import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { CheckoutIdentityError, saveCustomerCheckoutIdentity } from "../../../../lib/checkout-identity";
import { PrivateRequestError, readPrivateJson } from "../../../../lib/private-request";
import { isUnknownRecord } from "../../../../lib/unknown-data";

const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status, headers: { "cache-control": "private, no-store" }
});

export async function POST(request: Request) {
  try {
    if (!isAllowedRequestOrigin(request)) return reply({ message: "Origem não permitida." }, 403);
    const auth = await createServerSupabaseClient();
    if (!auth) return reply({ message: "Não foi possível validar sua sessão." }, 503);
    const { data, error } = await auth.auth.getUser();
    if (error || !data.user) return reply({ message: "Entre na sua conta para alterar o CPF." }, 401);
    const body = await readPrivateJson(request, 1024);
    if (!isUnknownRecord(body) || Object.keys(body).some(key => key !== "cpf")
      || typeof body.cpf !== "string" || body.cpf.length > 20) {
      return reply({ message: "Informe um CPF válido." }, 400);
    }
    const db = createServiceSupabaseClient();
    if (!db) return reply({ message: "Não foi possível salvar o CPF agora." }, 503);
    const cpfLastFour = await saveCustomerCheckoutIdentity(db, data.user.id, body.cpf);
    return reply({ ok: true, cpfLastFour });
  } catch (error) {
    const status = error instanceof CheckoutIdentityError || error instanceof PrivateRequestError ? error.status : 503;
    return reply({ message: status === 400 ? "Informe um CPF válido." : "Não foi possível salvar o CPF agora." }, status);
  }
}
