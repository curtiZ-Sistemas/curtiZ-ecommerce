import {
  isMercadoPagoTestCredential,
  MercadoPagoProviderError,
  MercadoPagoTestPaymentProvider
} from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { isValidCpf, sanitizeCpf } from "@/lib/personal-data";
import { normalizeMercadoPagoStatus, publicPaymentState } from "@/lib/mercadopago-payment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";

const schema = z.object({
  orderId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  payment: z.object({
    token: z.string().trim().min(1).max(500).optional(),
    issuer_id: z.union([z.string(), z.number()]).optional(),
    payment_method_id: z.string().trim().regex(/^[a-z0-9_-]{2,50}$/u),
    installments: z.coerce.number().int().min(1).max(48).default(1),
    payer: z.object({
      entity_type: z.enum(["individual", "association"]),
      identification: z.object({
        number: z.string().max(20)
      })
    })
  })
});

const noStore = { "cache-control": "private, no-store" };
const response = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: noStore });

const logFailure = (code: string, status?: number) => {
  console.error("[mercadopago-bricks] payment not completed", {
    code,
    ...(status ? { providerStatus: status } : {})
  });
};

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return response({ ok: false, message: "Origem não permitida." }, 403);
  }
  const auth = await createServerSupabaseClient();
  const { data: authData } = auth ? await auth.auth.getUser() : { data: { user: null } };
  if (!authData.user) {
    return response({ ok: false, message: "Entre na sua conta para pagar." }, 401);
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ ok: false, message: "Revise os dados do pagamento." }, 400);
  }
  const customerDocument = sanitizeCpf(parsed.data.payment.payer.identification.number);
  if (!isValidCpf(customerDocument)) {
    return response({ ok: false, message: "Revise o CPF informado no pagamento." }, 400);
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim();
  if (!isMercadoPagoTestCredential(accessToken) || !isMercadoPagoTestCredential(publicKey)) {
    logFailure("TEST_CREDENTIALS_REQUIRED");
    return response({ ok: false, message: "O pagamento de teste está indisponível." }, 503);
  }
  const db = createServiceSupabaseClient();
  if (!db) {
    logFailure("DATABASE_UNAVAILABLE");
    return response({ ok: false, message: "Não foi possível confirmar o pagamento agora." }, 503);
  }

  const orderResult = readQueryResult(await db
    .from("orders")
    .select("id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,cpf_last_four,status,grand_total,currency")
    .eq("id", parsed.data.orderId)
    .eq("customer_id", authData.user.id)
    .maybeSingle());
  if (orderResult.error || !isUnknownRecord(orderResult.data)) {
    return response({ ok: false, message: "Pedido não encontrado." }, 404);
  }
  const order = orderResult.data;
  const orderId = readString(order, "id");
  const orderCode = readString(order, "public_code");
  const orderCpfLastFour = readString(order, "cpf_last_four");
  const orderStatus = readString(order, "status");
  const orderCurrency = readString(order, "currency");
  const orderEmail = readString(order, "customer_email_snapshot");
  const orderCustomerName = readString(order, "customer_name_snapshot");
  if (!orderId || !orderCode || !orderEmail || !orderCustomerName) {
    logFailure("INVALID_INTERNAL_ORDER");
    return response({ ok: false, message: "Não foi possível validar o pedido." }, 503);
  }
  if (orderCpfLastFour && !customerDocument.endsWith(orderCpfLastFour)) {
    return response({ ok: false, message: "Revise o CPF informado no pagamento." }, 400);
  }

  const paymentResult = readQueryResult(await db
    .from("payments")
    .select("id,status,provider_payment_id,external_reference,amount,currency")
    .eq("order_id", orderId)
    .eq("provider", "mercadopago")
    .maybeSingle());
  if (paymentResult.error || !isUnknownRecord(paymentResult.data)) {
    logFailure("LOCAL_PAYMENT_NOT_FOUND");
    return response({ ok: false, message: "Não foi possível localizar o pagamento." }, 503);
  }
  const localPayment = paymentResult.data;
  const localPaymentId = readString(localPayment, "id");
  const existingProviderPaymentId = readString(localPayment, "provider_payment_id");
  if (!localPaymentId) {
    logFailure("INVALID_LOCAL_PAYMENT");
    return response({ ok: false, message: "Não foi possível localizar o pagamento." }, 503);
  }
  const existingStatus = normalizeMercadoPagoStatus(readString(localPayment, "status"));
  if (["approved", "rejected", "cancelled", "refunded", "charged_back"].includes(existingStatus)) {
    return response({
      ok: true,
      status: publicPaymentState(existingStatus),
      orderCode
    }, 200);
  }
  if (orderStatus !== "pending_payment") {
    return response({ ok: false, message: "Este pedido não aceita um novo pagamento." }, 409);
  }

  const amountInCents = Math.round(readNumber(order, "grand_total") * 100);
  if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0 || orderCurrency !== "BRL") {
    logFailure("INVALID_INTERNAL_AMOUNT");
    return response({ ok: false, message: "Não foi possível validar o valor do pedido." }, 503);
  }

  try {
    const provider = new MercadoPagoTestPaymentProvider(accessToken);
    const created = existingProviderPaymentId
      ? await provider.getPayment(existingProviderPaymentId)
      : await provider.createPayment({
          orderId,
          orderCode,
          amountInCents,
          currency: "BRL",
          idempotencyKey: parsed.data.idempotencyKey,
          customerEmail: orderEmail,
          customerName: orderCustomerName,
          customerDocument,
          entityType: parsed.data.payment.payer.entity_type,
          paymentMethodId: parsed.data.payment.payment_method_id,
          ...(parsed.data.payment.token ? { token: parsed.data.payment.token } : {}),
          ...(parsed.data.payment.issuer_id !== undefined
            ? { issuerId: String(parsed.data.payment.issuer_id) }
            : {}),
          installments: parsed.data.payment.installments
        });
    if (
      created.amountInCents !== amountInCents ||
      created.currency !== "BRL" ||
      created.externalReference !== orderCode
    ) {
      logFailure("PROVIDER_PAYMENT_MISMATCH");
      return response({ ok: false, message: "O pagamento precisa de verificação." }, 409);
    }
    const instructionResult = readQueryResult(await db.from("payments").update({
      provider_payment_id: created.id,
      payment_method_summary: [created.paymentTypeId, created.paymentMethodId].filter(Boolean).join(":"),
      status_detail: created.statusDetail || null,
      expires_at: created.expiresAt,
      pix_copy_paste: created.pixCopyPaste || null,
      pix_qr_code_base64: created.pixQrCodeBase64 || null,
      boleto_url: created.boletoUrl || null,
      digitable_line: created.digitableLine || null,
      updated_at: new Date().toISOString()
    }).eq("id", localPaymentId));
    if (instructionResult.error) {
      logFailure("PAYMENT_PERSISTENCE_FAILED");
      return response({ ok: false, message: "Não foi possível salvar o pagamento agora." }, 503);
    }

    const confirmed = existingProviderPaymentId ? created : await provider.getPayment(created.id);
    if (
      confirmed.amountInCents !== amountInCents ||
      confirmed.currency !== "BRL" ||
      confirmed.externalReference !== orderCode
    ) {
      logFailure("PROVIDER_PAYMENT_MISMATCH");
      return response({ ok: false, message: "O pagamento precisa de verificação." }, 409);
    }
    const normalizedStatus = normalizeMercadoPagoStatus(confirmed.status);
    const finalizeResult = readQueryResult(await db.rpc("finalize_mercadopago_payment", {
      p_provider_event_id: `test-check-${confirmed.id}-${confirmed.status}`,
      p_provider_payment_id: confirmed.id,
      p_external_reference: confirmed.externalReference,
      p_amount: confirmed.amountInCents / 100,
      p_currency: confirmed.currency,
      p_status: normalizedStatus,
      p_paid_at: confirmed.dateApproved
    }) as unknown);
    if (finalizeResult.error || finalizeResult.data === "manual_review") {
      logFailure("PAYMENT_RECONCILIATION_FAILED");
      return response({ ok: false, message: "O pagamento precisa de verificação." }, 503);
    }
    return response({
      ok: true,
      status: publicPaymentState(normalizedStatus),
      orderCode,
      orderId,
      providerPaymentId: confirmed.id
    }, 200);
  } catch (error) {
    const providerStatus = error instanceof MercadoPagoProviderError ? error.httpStatus : undefined;
    logFailure("PROVIDER_REQUEST_FAILED", providerStatus);
    return response(
      {
        ok: false,
        message: providerStatus && providerStatus < 500
          ? "Pagamento recusado. Revise os dados e tente novamente."
          : "Não foi possível processar o pagamento agora."
      },
      providerStatus && providerStatus < 500 ? 422 : 502
    );
  }
}
