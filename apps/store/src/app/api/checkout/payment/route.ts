import { isMercadoPagoTestCredential, MercadoPagoProviderError, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeOptionalCouponCode } from "@/lib/checkout-flow";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { CUSTOMER_EMAIL_MAX_LENGTH, isValidBrazilianPhone, isValidCpf, phoneDigits, sanitizeCpf } from "@/lib/personal-data";
import { encryptPII } from "@/lib/pii";
import { normalizeMercadoPagoStatus, publicPaymentState } from "@/lib/mercadopago-payment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";

const checkoutSchema = z.object({
  couponCode: z.string().trim().max(40).optional(),
  customer: z.object({
    name: z.string().trim().min(3).max(120), email: z.string().trim().email().max(CUSTOMER_EMAIL_MAX_LENGTH),
    phone: z.string().trim().max(20).refine(isValidBrazilianPhone).transform(phoneDigits),
    cpf: z.string().max(20).refine((value) => !value || isValidCpf(value)).transform((value) => value ? sanitizeCpf(value) : "")
  }),
  address: z.object({
    postalCode: z.string().regex(/^\D*\d(?:\D*\d){7}\D*$/), street: z.string().trim().min(3).max(160),
    number: z.string().trim().min(1).max(20), complement: z.string().trim().max(120).optional(),
    district: z.string().trim().min(2).max(100), city: z.string().trim().min(2).max(100), state: z.string().trim().length(2)
  }),
  lines: z.array(z.object({
    productId: z.string().uuid(), variantId: z.string().uuid(), color: z.string().trim().min(1).max(80),
    size: z.string().trim().min(1).max(40), quantity: z.number().int().min(1).max(10)
  })).min(1).max(50)
});
const schema = z.object({
  orderId: z.string().uuid().optional(), idempotencyKey: z.string().uuid(), checkout: checkoutSchema.optional(),
  payment: z.object({
    token: z.string().trim().min(1).max(500).optional(), issuer_id: z.union([z.string(), z.number()]).optional(),
    payment_method_id: z.string().trim().regex(/^[a-z0-9_-]{2,50}$/u), installments: z.coerce.number().int().min(1).max(48).default(1),
    payer: z.object({ entity_type: z.enum(["individual", "association"]), identification: z.object({ number: z.string().max(20) }) })
  })
}).refine((value) => Boolean(value.orderId || value.checkout), "Pedido ou checkout obrigatório.");

const noStore = { "cache-control": "private, no-store" };
const response = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: noStore });
const logFailure = (code: string, status?: number) => console.error("[mercadopago-bricks] payment not completed", {
  code, ...(status ? { providerStatus: status } : {})
});

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) return response({ ok: false, message: "Origem não permitida." }, 403);
  const auth = await createServerSupabaseClient();
  const authData = auth ? await auth.auth.getUser() : null;
  const user = authData?.data.user;
  if (!auth || !user) return response({ ok: false, message: "Entre na sua conta para pagar." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ ok: false, message: "Revise os dados do pagamento." }, 400);
  const customerDocument = sanitizeCpf(parsed.data.payment.payer.identification.number);
  if (!isValidCpf(customerDocument)) return response({ ok: false, message: "Revise o CPF informado no pagamento." }, 400);

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim();
  if (!isMercadoPagoTestCredential(accessToken) || !isMercadoPagoTestCredential(publicKey)) {
    logFailure("TEST_CREDENTIALS_REQUIRED");
    return response({ ok: false, message: "O pagamento de teste está indisponível." }, 503);
  }
  const db = createServiceSupabaseClient();
  if (!db) return response({ ok: false, message: "Não foi possível confirmar o pagamento agora." }, 503);
  const provider = new MercadoPagoTestPaymentProvider(accessToken);
  try {
    const availableMethods = await provider.getPaymentMethodIds();
    if (!availableMethods.includes(parsed.data.payment.payment_method_id)) {
      return response({ ok: false, message: "O meio de pagamento selecionado não está disponível." }, 400);
    }
  } catch (error) {
    const providerStatus = error instanceof MercadoPagoProviderError ? error.httpStatus : undefined;
    logFailure("PAYMENT_METHOD_VALIDATION_FAILED", providerStatus);
    return response({ ok: false, message: "Não foi possível validar os meios de pagamento agora." }, 502);
  }

  let orderId = parsed.data.orderId ?? "";
  if (!orderId && parsed.data.checkout) {
    const checkout = parsed.data.checkout;
    let cpfCiphertext = "";
    let cpfLastFour = "";
    try {
      if (checkout.customer.cpf) {
        cpfCiphertext = encryptPII(checkout.customer.cpf);
        cpfLastFour = checkout.customer.cpf.slice(-4);
      } else {
        const profile = readQueryResult(await auth.from("profiles").select("cpf_last_four")
          .eq("id", user.id).maybeSingle());
        if (isUnknownRecord(profile.data)) cpfLastFour = readString(profile.data, "cpf_last_four");
        const previous = readQueryResult(await auth.from("orders").select("cpf_ciphertext,cpf_last_four")
          .eq("customer_id", user.id).not("cpf_ciphertext", "is", null)
          .order("created_at", { ascending: false }).limit(1).maybeSingle());
        if (isUnknownRecord(previous.data)) {
          cpfCiphertext = readString(previous.data, "cpf_ciphertext");
          cpfLastFour ||= readString(previous.data, "cpf_last_four");
        }
      }
      if (!cpfLastFour || !customerDocument.endsWith(cpfLastFour)) throw new Error("cpf_mismatch");
    } catch {
      return response({ ok: false, message: "Revise o CPF informado no pagamento." }, 400);
    }
    const creation = readQueryResult(await db.rpc("confirm_professional_checkout_order", {
      p_idempotency_key: parsed.data.idempotencyKey,
      p_customer_id: user.id,
      p_payment_method_id: parsed.data.payment.payment_method_id,
      p_customer_name: checkout.customer.name, p_customer_email: checkout.customer.email,
      p_customer_phone: checkout.customer.phone, p_cpf_ciphertext: cpfCiphertext, p_cpf_last_four: cpfLastFour,
      p_shipping_address: checkout.address,
      p_lines: checkout.lines.map((line) => ({ product_id: line.productId, variant_id: line.variantId, quantity: line.quantity })),
      p_coupon_code: normalizeOptionalCouponCode(checkout.couponCode) ?? null,
      p_reservation_minutes: Number(process.env.INVENTORY_RESERVATION_MINUTES) || 30
    }));
    const created = isUnknownRecord(creation.data) ? creation.data : null;
    orderId = created ? readString(created, "orderId") : "";
    if (creation.error || !orderId) {
      const message = isUnknownRecord(creation.error) ? readString(creation.error, "message") : "";
      const invalidCoupon = message.includes("coupon");
      return response({
        ok: false, code: invalidCoupon ? "INVALID_COUPON" : "CHECKOUT_CHANGED",
        message: invalidCoupon ? "Este cupom não é válido." : "Preço, estoque ou frete mudaram. Revise o checkout."
      }, 409);
    }
  }

  const orderResult = readQueryResult(await db.from("orders")
    .select("id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,cpf_last_four,status,grand_total,currency")
    .eq("id", orderId).eq("customer_id", user.id).maybeSingle());
  if (orderResult.error || !isUnknownRecord(orderResult.data)) return response({ ok: false, message: "Pedido não encontrado." }, 404);
  const order = orderResult.data;
  const orderCode = readString(order, "public_code");
  if (!orderCode || readString(order, "status") !== "pending_payment") {
    return response({ ok: false, message: "Este pedido não aceita um novo pagamento." }, 409);
  }
  const orderCpfLastFour = readString(order, "cpf_last_four");
  if (orderCpfLastFour && !customerDocument.endsWith(orderCpfLastFour)) return response({ ok: false, message: "Revise o CPF informado no pagamento." }, 400);

  const paymentResult = readQueryResult(await db.from("payments")
    .select("id,status,provider_payment_id,amount,currency").eq("order_id", orderId).eq("provider", "mercadopago").maybeSingle());
  if (paymentResult.error || !isUnknownRecord(paymentResult.data)) return response({ ok: false, message: "Não foi possível localizar o pagamento." }, 503);
  const localPayment = paymentResult.data;
  const paymentId = readString(localPayment, "id");
  const existingStatus = normalizeMercadoPagoStatus(readString(localPayment, "status"));
  const existingProviderPaymentId = readString(localPayment, "provider_payment_id");
  if (!paymentId) return response({ ok: false, message: "Não foi possível localizar o pagamento." }, 503);
  if (["approved", "cancelled", "refunded", "charged_back"].includes(existingStatus)) {
    return response({ ok: true, status: publicPaymentState(existingStatus), orderCode, orderId }, 200);
  }

  const amountInCents = Math.round(readNumber(order, "grand_total") * 100);
  if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0 || readString(order, "currency") !== "BRL") {
    return response({ ok: false, message: "Não foi possível validar o valor do pedido." }, 503);
  }

  const method = parsed.data.payment.payment_method_id;
  const attemptResult = readQueryResult(await db.rpc("begin_mercadopago_payment_attempt", {
    p_order_id: orderId, p_idempotency_key: parsed.data.idempotencyKey, p_payment_method: method
  }));
  if (attemptResult.error || !isUnknownRecord(attemptResult.data)) {
    logFailure("PAYMENT_ATTEMPT_PERSISTENCE_FAILED");
    return response({ ok: false, message: "Não foi possível registrar a tentativa de pagamento." }, 503);
  }
  const attemptId = readString(attemptResult.data, "id");
  const attemptProviderId = readString(attemptResult.data, "providerPaymentId");

  try {
    const providerId = attemptProviderId || (existingStatus !== "rejected" ? existingProviderPaymentId : "");
    const created = providerId ? await provider.getPayment(providerId) : await provider.createPayment({
      orderId, orderCode, amountInCents, currency: "BRL", idempotencyKey: parsed.data.idempotencyKey,
      customerEmail: readString(order, "customer_email_snapshot"), customerName: readString(order, "customer_name_snapshot"),
      customerDocument, entityType: parsed.data.payment.payer.entity_type, paymentMethodId: method,
      ...(parsed.data.payment.token ? { token: parsed.data.payment.token } : {}),
      ...(parsed.data.payment.issuer_id !== undefined ? { issuerId: String(parsed.data.payment.issuer_id) } : {}),
      installments: parsed.data.payment.installments
    });
    if (created.amountInCents !== amountInCents || created.currency !== "BRL" || created.externalReference !== orderCode) {
      return response({ ok: false, message: "O pagamento precisa de verificação." }, 409);
    }
    const normalizedStatus = normalizeMercadoPagoStatus(created.status);
    const statusDetail = created.status === "expired" ? "expired" : created.statusDetail;
    const methodSummary = [created.paymentTypeId, created.paymentMethodId || method].filter(Boolean).join(":");
    const persistence = readQueryResult(await db.from("payments").update({
      provider_payment_id: created.id, payment_method_summary: methodSummary, status_detail: statusDetail || null,
      expires_at: created.expiresAt, pix_copy_paste: created.pixCopyPaste || null,
      pix_qr_code_base64: created.pixQrCodeBase64 || null, boleto_url: created.boletoUrl || null,
      digitable_line: created.digitableLine || null, updated_at: new Date().toISOString()
    }).eq("id", paymentId));
    const attemptPersistence = readQueryResult(await db.from("payment_attempts").update({
      provider_payment_id: created.id, payment_method: methodSummary || method, status: normalizedStatus,
      status_detail: statusDetail || null, updated_at: new Date().toISOString()
    }).eq("id", attemptId));
    if (persistence.error || attemptPersistence.error) return response({ ok: false, message: "Não foi possível salvar o pagamento agora." }, 503);

    const finalizeResult = readQueryResult(await db.rpc("finalize_mercadopago_payment", {
      p_provider_event_id: `test-check-${created.id}-${created.status}`, p_provider_payment_id: created.id,
      p_external_reference: created.externalReference, p_amount: created.amountInCents / 100,
      p_currency: created.currency, p_status: normalizedStatus, p_paid_at: created.dateApproved,
      p_provider_fee: created.providerFeeInCents === null ? null : created.providerFeeInCents / 100,
      p_net_received_amount: created.netReceivedInCents === null ? null : created.netReceivedInCents / 100,
      p_payment_method: methodSummary || method,
      p_installments: created.installments,
      p_status_detail: statusDetail || null
    }) as unknown);
    if (finalizeResult.error || finalizeResult.data === "manual_review") return response({ ok: false, message: "O pagamento precisa de verificação." }, 503);
    return response({ ok: true, status: publicPaymentState(normalizedStatus), orderCode, orderId, providerPaymentId: created.id }, 200);
  } catch (error) {
    const providerStatus = error instanceof MercadoPagoProviderError ? error.httpStatus : undefined;
    await db.from("payment_attempts").update({
      status: "rejected", status_detail: "provider_request_failed", updated_at: new Date().toISOString()
    }).eq("id", attemptId);
    logFailure("PROVIDER_REQUEST_FAILED", providerStatus);
    return response({ ok: false, orderId, orderCode, message: providerStatus && providerStatus < 500
      ? "Pagamento recusado. Revise os dados e tente novamente." : "Não foi possível processar o pagamento agora." },
    providerStatus && providerStatus < 500 ? 422 : 502);
  }
}
