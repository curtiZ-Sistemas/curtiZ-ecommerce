import { logServerEvent } from "@curtiz/security";
import { getIntegrationConfig } from "@curtiz/config";
import { isMercadoPagoTestCredential, MercadoPagoProviderError, MercadoPagoTestPaymentProvider } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeOptionalCouponCode } from "@/lib/checkout-flow";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { CUSTOMER_EMAIL_MAX_LENGTH, isValidBrazilianPhone, isValidCpf, phoneDigits, sanitizeCpf } from "@/lib/personal-data";
import { encryptPII } from "@/lib/pii";
import { normalizeMercadoPagoStatus, publicPaymentState } from "@/lib/mercadopago-payment";
import { readMercadoPagoPayerDocument } from "@/lib/mercadopago-payer-identity";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { validateSavedCardCustomer, validateSavedCardPayer, SavedCardsError } from "@/lib/mercadopago-saved-cards";
import { isUnknownRecord, readNumber, readQueryResult, readString } from "@/lib/unknown-data";
import { isCheckoutBusinessError, isMissingAuthentication, safeDatabaseError } from "../../../../lib/checkout-diagnostics";

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
  orderId: z.string().uuid().optional(), idempotencyKey: z.string().uuid(),
  checkoutIdempotencyKey: z.string().uuid().optional(), checkout: checkoutSchema.optional(),
  payment: z.object({
    token: z.string().trim().min(1).max(500).optional(), issuer_id: z.union([z.string(), z.number()]).optional(),
    payment_method_id: z.string().trim().regex(/^[a-z0-9_-]{2,50}$/u), installments: z.coerce.number().int().min(1).max(48).default(1),
    payer: z.object({ entity_type: z.enum(["individual", "association"]), type: z.literal("customer").optional(),
      id: z.string().regex(/^[a-zA-Z0-9_+-]{1,100}$/u).optional(), identification: z.object({
      type: z.literal("CPF").default("CPF"), number: z.string().max(20)
    }).optional() })
  })
}).refine((value) => Boolean(value.orderId || value.checkout), "Pedido ou checkout obrigatório.");

const noStore = { "cache-control": "private, no-store" };
const response = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: noStore });
const checkoutConflict = (error: unknown) => {
  const reason = safeDatabaseError(error).message;
  if (reason === "idempotency_conflict") return {
    code: "CHECKOUT_IDEMPOTENCY_CONFLICT", recovery: "view_order",
    message: "Este checkout já está vinculado a um pedido com outros dados. Continue o pagamento desse pedido."
  };
  if (reason.includes("coupon")) return {
    code: reason === "coupon_limit_reached" ? "COUPON_LIMIT_REACHED" : "INVALID_COUPON",
    recovery: "review_checkout", message: reason === "coupon_limit_reached"
      ? "O limite de uso desse cupom foi atingido. Revise o checkout."
      : reason === "invalid_coupon_lines"
        ? "O cupom não se aplica aos itens escolhidos. Revise o checkout."
        : "O cupom não está mais disponível. Revise o checkout."
  };
  if (reason === "customer_identity_required") return {
    code: "CUSTOMER_IDENTITY_REQUIRED", recovery: "review_checkout", message: "Informe e salve o CPF do cliente no checkout."
  };
  if (reason === "order_not_eligible") return {
    code: "ORDER_NOT_PAYABLE", recovery: "view_order", message: "Este pedido não aceita um novo pagamento. Acompanhe seu status."
  };
  if (reason === "invalid_payment_method") return {
    code: "INVALID_PAYMENT_METHOD", recovery: "new_attempt", message: "Selecione outro meio de pagamento."
  };
  if (reason === "checkout_line_unavailable") return {
    code: "CHECKOUT_LINE_UNAVAILABLE", recovery: "review_checkout",
    message: "Um produto ou variante não está mais disponível. Revise os itens do checkout."
  };
  if (reason === "invalid quantity") return {
    code: "CHECKOUT_INVALID_QUANTITY", recovery: "review_checkout",
    message: "Uma quantidade não é permitida. Revise os itens do checkout."
  };
  if (["invalid_checkout_lines", "duplicate_checkout_line"].includes(reason)) return {
    code: "CHECKOUT_INVALID_ITEMS", recovery: "review_checkout",
    message: "Há itens inválidos ou repetidos. Revise os itens do checkout."
  };
  if (reason === "invalid_checkout_payload") return {
    code: "CHECKOUT_INVALID_DATA", recovery: "review_checkout",
    message: "Os dados do cliente ou endereço estão incompletos. Revise o checkout."
  };
  return {
    code: reason === "insufficient stock" ? "CHECKOUT_STOCK_CHANGED" : "CHECKOUT_CHANGED",
    recovery: "review_checkout", message: reason === "insufficient stock"
      ? "A quantidade disponível mudou. Revise os itens do checkout."
      : "Os itens ou dados do checkout mudaram. Revise o checkout antes de pagar."
  };
};
const logFailure = (code: string, status?: number, requestId?: string, error?: unknown) => {
  const database = safeDatabaseError(error);
  logServerEvent("error", "mercadopago_bricks_payment_not_completed", {
    code, requestId, providerStatus: status ?? null, databaseCode: database.code || null,
    message: database.message || null, details: database.details || null, hint: database.hint || null
  });
};

async function handlePost(request: NextRequest, requestId: string) {
  const reportFailure = (code: string, status?: number, error?: unknown) => logFailure(code, status, requestId, error);
  const auth = await createServerSupabaseClient();
  if (!auth) {
    reportFailure("PAYMENT_CONFIGURATION_MISSING");
    return response({
      ok: false, code: "PAYMENT_CONFIGURATION_MISSING",
      message: "O pagamento está temporariamente indisponível."
    }, 503);
  }
  const authData = await auth.auth.getUser();
  const user = authData?.data.user;
  if (authData.error && !isMissingAuthentication(authData.error)) {
    reportFailure("AUTHENTICATION_UNAVAILABLE", undefined, authData.error);
    return response({
      ok: false, code: "AUTHENTICATION_UNAVAILABLE",
      message: "Não foi possível validar sua sessão agora."
    }, 503);
  }
  if (!user) return response({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Entre na sua conta para pagar." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const invalidCustomerCpf = parsed.error.issues.some((issue) => issue.path.join(".") === "checkout.customer.cpf");
    return response({ ok: false, code: invalidCustomerCpf ? "INVALID_CUSTOMER_CPF" : "INVALID_PAYMENT_REQUEST",
      recovery: invalidCustomerCpf ? "review_checkout" : "new_attempt",
      message: invalidCustomerCpf ? "Revise o CPF do cliente no checkout." : "Revise os dados do pagamento." }, 400);
  }

  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
  const publicKey = process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim();
  const paymentMode = isMercadoPagoTestCredential(accessToken) && isMercadoPagoTestCredential(publicKey)
    ? "test" : "production";
  if (!isMercadoPagoTestCredential(accessToken) || !isMercadoPagoTestCredential(publicKey)) {
    reportFailure("TEST_CREDENTIALS_REQUIRED");
    return response({ ok: false, message: "O pagamento de teste está indisponível." }, 503);
  }
  // This mode is established by server credentials, never by the submitted payload.
  const savedPayer = parsed.data.payment.payer.type === "customer";
  const customerDocument = readMercadoPagoPayerDocument(parsed.data.payment.payer.identification?.number ?? "", paymentMode) ?? "";
  if (!customerDocument && (parsed.data.payment.payer.identification?.number || !savedPayer)) return response({ ok: false, code: "INVALID_PAYER_DOCUMENT", recovery: "new_attempt",
    message: "Revise o CPF de teste informado no pagamento." }, 400);
  const db = createServiceSupabaseClient();
  if (!db) {
    reportFailure("PAYMENT_SERVER_CONFIGURATION_MISSING");
    return response({
      ok: false, code: "PAYMENT_SERVER_CONFIGURATION_MISSING",
      message: "Não foi possível confirmar o pagamento agora."
    }, 503);
  }
  const provider = new MercadoPagoTestPaymentProvider(accessToken);
  let providerCustomerId: string | undefined;
  if (savedPayer) {
    try {
      providerCustomerId = await validateSavedCardCustomer(db, user, parsed.data.payment.payer.id ?? "");
    } catch (error) {
      return response({ ok: false, code: "SAVED_CARD_UNAVAILABLE", recovery: "new_attempt",
        message: "Este cartão não está disponível. Selecione outro cartão ou meio de pagamento." }, error instanceof SavedCardsError ? error.status : 503);
    }
  } else if (parsed.data.payment.payer.id) return response({ ok: false, code: "INVALID_PAYMENT_REQUEST", recovery: "new_attempt",
    message: "Revise os dados do pagamento." }, 400);
  try {
    const availableMethods = await provider.getPaymentMethodIds();
    if (!availableMethods.includes(parsed.data.payment.payment_method_id)) {
      return response({ ok: false, code: "INVALID_PAYMENT_METHOD", recovery: "new_attempt",
        message: "O meio de pagamento selecionado não está disponível." }, 400);
    }
  } catch (error) {
    const providerStatus = error instanceof MercadoPagoProviderError ? error.httpStatus : undefined;
    reportFailure("PAYMENT_METHOD_VALIDATION_FAILED", providerStatus);
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
      }
      // An empty customer CPF lets the RPC reuse the private, previously validated identity.
    } catch {
      return response({ ok: false, code: "CUSTOMER_IDENTITY_UNAVAILABLE", recovery: "retry_attempt",
        message: "Não foi possível proteger a identificação do cliente agora." }, 503);
    }
    const creation = readQueryResult(await db.rpc("confirm_professional_checkout_order", {
      p_idempotency_key: parsed.data.checkoutIdempotencyKey ?? parsed.data.idempotencyKey,
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
      if (!isCheckoutBusinessError(creation.error)) {
        reportFailure("CHECKOUT_ORDER_CREATION_UNAVAILABLE", undefined, creation.error);
        return response({ ok: false, code: "CHECKOUT_SERVICE_UNAVAILABLE", message: "O checkout está temporariamente indisponível." }, 503);
      }
      const conflict = checkoutConflict(creation.error);
      if (conflict.code === "CHECKOUT_IDEMPOTENCY_CONFLICT") {
        const keyResult = readQueryResult(await db.from("idempotency_keys").select("resource_id")
          .eq("scope", "mercadopago.checkout.test").eq("key", parsed.data.checkoutIdempotencyKey ?? parsed.data.idempotencyKey).maybeSingle());
        if (isUnknownRecord(keyResult.data)) {
          const existing = readQueryResult(await db.from("orders").select("id,public_code")
            .eq("id", readString(keyResult.data, "resource_id")).eq("customer_id", user.id).maybeSingle());
          if (isUnknownRecord(existing.data)) return response({ ok: false, ...conflict,
            orderId: readString(existing.data, "id"), orderCode: readString(existing.data, "public_code") }, 409);
        }
      }
      return response({ ok: false, ...conflict }, 409);
    }
  }

  const orderResult = readQueryResult(await db.from("orders")
    .select("id,public_code,customer_id,customer_email_snapshot,customer_name_snapshot,cpf_last_four,status,grand_total,currency")
    .eq("id", orderId).eq("customer_id", user.id).maybeSingle());
  if (orderResult.error) {
    reportFailure("ORDER_QUERY_FAILED", undefined, orderResult.error);
    return response({ ok: false, code: "ORDER_QUERY_FAILED", message: "Não foi possível consultar o pedido agora." }, 503);
  }
  if (!isUnknownRecord(orderResult.data)) return response({ ok: false, message: "Pedido não encontrado." }, 404);
  const order = orderResult.data;
  const orderCode = readString(order, "public_code");
  const orderContext = { orderId, orderCode };
  const orderFailure = (body: Record<string, unknown>, status: number) => response({ ok: false, ...orderContext, ...body }, status);
  if (!providerCustomerId && !readMercadoPagoPayerDocument(customerDocument, paymentMode, readString(order, "cpf_last_four"))) {
    return orderFailure({ code: "INVALID_PAYER_DOCUMENT", recovery: "new_attempt",
      message: "Revise o CPF informado no pagamento." }, 400);
  }

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
  if (!orderCode || readString(order, "status") !== "pending_payment") {
    return orderFailure({ code: "ORDER_NOT_PAYABLE", recovery: "view_order",
      message: "Este pedido não aceita um novo pagamento. Acompanhe seu status." }, 409);
  }

  const amountInCents = Math.round(readNumber(order, "grand_total") * 100);
  if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0 || readString(order, "currency") !== "BRL") {
    return response({ ok: false, message: "Não foi possível validar o valor do pedido." }, 503);
  }

  const method = parsed.data.payment.payment_method_id;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
    orderId, amountInCents, currency: "BRL", payment: { ...parsed.data.payment,
      payer: { ...parsed.data.payment.payer, identification: { type: "CPF", number: customerDocument } } }
  })));
  const requestFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (providerCustomerId) {
    const findAttempt = async () => readQueryResult(await db.from("payment_attempts").select("id,request_fingerprint")
      .eq("provider", "mercadopago").eq("order_id", orderId).eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle());
    const previousAttempt = await findAttempt();
    if (previousAttempt.error) return orderFailure({ code: "PAYMENT_ATTEMPT_UNAVAILABLE", recovery: "retry_attempt",
      message: "Verifique o resultado da mesma tentativa." }, 503);
    // A saved-card attempt is registered only after ownership/token validation. Its immutable
    // fingerprint then permits exact HTTP replay, including a lost provider response.
    if (!isUnknownRecord(previousAttempt.data) || !readString(previousAttempt.data, "request_fingerprint")) {
      try { await validateSavedCardPayer(db, user, providerCustomerId, parsed.data.payment.token ?? ""); }
      catch {
        const concurrentAttempt = await findAttempt();
        if (concurrentAttempt.error || isUnknownRecord(concurrentAttempt.data)) return orderFailure({ code: "PAYMENT_RESULT_UNCERTAIN",
          recovery: "retry_attempt", message: "Verifique o resultado da mesma tentativa." }, 502);
        return orderFailure({ code: "SAVED_CARD_UNAVAILABLE", recovery: "new_attempt",
          message: "Este cartão não está disponível. Selecione outro cartão ou meio de pagamento." }, 503);
      }
    }
  }
  const attemptResult = readQueryResult(await db.rpc("begin_mercadopago_payment_attempt", {
    p_order_id: orderId, p_idempotency_key: parsed.data.idempotencyKey, p_payment_method: method,
    p_request_fingerprint: requestFingerprint
  }));
  if (attemptResult.error || !isUnknownRecord(attemptResult.data)) {
    const reason = safeDatabaseError(attemptResult.error).message;
    if (["payment_in_progress", "idempotency_conflict", "payment_not_eligible"].includes(reason)) {
      return orderFailure({ code: reason === "payment_in_progress" ? "PAYMENT_IN_PROGRESS"
        : reason === "idempotency_conflict" ? "PAYMENT_ATTEMPT_CONFLICT" : "ORDER_NOT_PAYABLE",
      recovery: reason === "payment_in_progress" ? "retry_attempt" : "view_order",
      message: reason === "payment_in_progress"
        ? "Já existe uma tentativa em processamento. Verifique o mesmo pagamento antes de tentar outro."
        : reason === "idempotency_conflict"
          ? "Esta tentativa já está vinculada a outros dados. Acompanhe o pedido antes de pagar novamente."
          : "Este pedido não aceita um novo pagamento. Acompanhe seu status." }, 409);
    }
    reportFailure("PAYMENT_ATTEMPT_PERSISTENCE_FAILED", undefined, attemptResult.error);
    return orderFailure({ code: "PAYMENT_ATTEMPT_UNAVAILABLE", recovery: "retry_attempt",
      message: "Não foi possível registrar a tentativa de pagamento." }, 503);
  }
  const attemptId = readString(attemptResult.data, "id");
  const attemptProviderId = readString(attemptResult.data, "providerPaymentId");
  if (!attemptId) return orderFailure({ code: "PAYMENT_ATTEMPT_UNAVAILABLE", recovery: "retry_attempt",
    message: "Não foi possível registrar a tentativa de pagamento." }, 503);
  if (readString(attemptResult.data, "status") === "rejected") {
    return response({ ok: true, status: "rejected", recovery: "new_attempt", ...orderContext,
      message: "Pagamento recusado. Revise os dados e tente novamente." }, 200);
  }

  const providerId = attemptProviderId || (existingStatus !== "rejected" ? existingProviderPaymentId : "");
  try {
    const created = providerId ? await provider.getPayment(providerId) : await provider.createPayment({
      orderId, orderCode, amountInCents, currency: "BRL", idempotencyKey: parsed.data.idempotencyKey,
      customerEmail: readString(order, "customer_email_snapshot"), customerName: readString(order, "customer_name_snapshot"),
      customerDocument, entityType: parsed.data.payment.payer.entity_type, paymentMethodId: method,
      ...(providerCustomerId ? { providerCustomerId } : {}),
      ...(parsed.data.payment.token ? { token: parsed.data.payment.token } : {}),
      ...(parsed.data.payment.issuer_id !== undefined ? { issuerId: String(parsed.data.payment.issuer_id) } : {}),
      installments: parsed.data.payment.installments
    });
    if (created.amountInCents !== amountInCents || created.currency !== "BRL" || created.externalReference !== orderCode) {
      return orderFailure({ code: "PAYMENT_PROVIDER_MISMATCH", recovery: "view_order",
        message: "Os dados retornados pelo pagamento não correspondem ao pedido. O pagamento precisa de verificação." }, 409);
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
      provider_payment_id: created.id,
      status_detail: statusDetail || null, updated_at: new Date().toISOString()
    }).eq("id", attemptId));
    if (persistence.error || attemptPersistence.error) return orderFailure({ code: "PAYMENT_SAVE_UNAVAILABLE", recovery: "retry_attempt",
      message: "Não foi possível salvar o pagamento agora. Verifique a mesma tentativa." }, 503);

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
    if (finalizeResult.error || finalizeResult.data === "manual_review") return orderFailure({ code: "PAYMENT_VERIFICATION_REQUIRED",
      recovery: "view_order", message: "O pagamento precisa de verificação." }, 503);
    return response({ ok: true, status: publicPaymentState(normalizedStatus), orderCode, orderId, providerPaymentId: created.id,
      ...(normalizedStatus === "rejected" ? { recovery: "new_attempt", message: "Pagamento recusado. Revise os dados e tente novamente." } : {}) }, 200);
  } catch (error) {
    const providerStatus = error instanceof MercadoPagoProviderError ? error.httpStatus : undefined;
    const definitelyRejected = !providerId && (providerStatus === 400 || providerStatus === 422);
    if (definitelyRejected) {
      const rejection = readQueryResult(await db.from("payment_attempts").update({
        status: "rejected", status_detail: "provider_request_rejected", updated_at: new Date().toISOString()
      }).eq("id", attemptId).eq("status", "pending").is("provider_payment_id", null));
      if (rejection.error) return orderFailure({ code: "PAYMENT_ATTEMPT_UNAVAILABLE", recovery: "retry_attempt",
        message: "Não foi possível confirmar a recusa. Verifique a mesma tentativa." }, 503);
    }
    reportFailure("PROVIDER_REQUEST_FAILED", providerStatus);
    return orderFailure({ code: definitelyRejected ? "PROVIDER_PAYMENT_REJECTED" : "PAYMENT_RESULT_UNCERTAIN",
      recovery: definitelyRejected ? "new_attempt" : "retry_attempt", message: definitelyRejected
        ? "Pagamento recusado. Revise os dados e tente novamente."
        : "O resultado da tentativa ainda não foi confirmado. Tente novamente para verificar o mesmo pagamento." },
    definitelyRejected ? 422 : 502);
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    if (!isAllowedRequestOrigin(request)) {
      return NextResponse.json({ ok: false, code: "ORIGIN_NOT_ALLOWED", message: "Origem não permitida." },
        { status: 403, headers: { ...noStore, "x-request-id": requestId } });
    }
    if (!getIntegrationConfig().checkoutEnabled) {
      logFailure("CHECKOUT_DISABLED", undefined, requestId);
      return NextResponse.json({
        ok: false,
        code: "CHECKOUT_DISABLED",
        message: "Novos pagamentos estão temporariamente indisponíveis."
      }, { status: 503, headers: { ...noStore, "x-request-id": requestId } });
    }
    const result = await handlePost(request, requestId);
    result.headers.set("x-request-id", requestId);
    return result;
  } catch {
    logFailure("PAYMENT_RUNTIME_FAILURE", undefined, requestId);
    return NextResponse.json({
      ok: false,
      code: "PAYMENT_SERVICE_UNAVAILABLE",
      message: "Não foi possível processar o pagamento agora."
    }, { status: 503, headers: { ...noStore, "x-request-id": requestId } });
  }
}
