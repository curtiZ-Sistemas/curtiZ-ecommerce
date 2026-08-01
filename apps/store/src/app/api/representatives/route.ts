import { randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DemoRepresentativeError,
  getDemoRepresentativeSnapshot,
  listDemoRepresentativeApplications,
  recordDemoRepresentativeSale,
  registerDemoCreativeEvent,
  reviewDemoRepresentativeApplication,
  saveDemoRepresentativeDraft,
  submitDemoRepresentativeApplication
} from "@/lib/demo-representative-store";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { corsHeadersFor, isAllowedRequestOrigin } from "@/lib/http-origin";
import { encryptPII } from "@/lib/pii";
import { isUnknownRecord, readNumber, readQueryResult, readRows, readString } from "@/lib/unknown-data";

export const dynamic = "force-dynamic";

const draftValue = z.union([z.string().trim().max(500), z.boolean()]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_draft"),
    step: z.number().int().min(1).max(6),
    values: z.record(z.string().max(80), draftValue)
  }),
  z.object({ action: z.literal("submit") }),
  z.object({
    action: z.literal("review"),
    applicationId: z.string().uuid().or(z.literal("demo-approved-application")),
    decision: z.enum(["start_review", "request_documents", "approve", "reject", "suspend"]),
    reason: z.string().trim().min(3).max(2000)
  }),
  z.object({
    action: z.literal("record_sale"),
    idempotencyKey: z.string().uuid(),
    items: z
      .array(
        z.object({
          variantId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99)
        })
      )
      .min(1)
      .max(50)
      .refine(
        (items) => new Set(items.map((item) => item.variantId)).size === items.length,
        "Variantes duplicadas."
      ),
    customerReference: z.string().trim().regex(/^[A-Za-z0-9._/-]+$/u).max(80).optional()
  }),
  z.object({
    action: z.literal("creative_event"),
    creativeId: z.string().min(1).max(120),
    eventType: z.enum(["view", "download", "copy", "favorite", "unfavorite", "share"])
  })
]);

const noStore: Record<string, string> = { "cache-control": "private, no-store" };

const responseHeaders = (request: Request): Record<string, string> => {
  return { ...noStore, ...corsHeadersFor(request) };
};

export function OPTIONS(request: Request) {
  const headers = responseHeaders(request);
  if (request.headers.get("origin") && !("access-control-allow-origin" in headers)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

const demoSessionFor = (request: NextRequest) =>
  process.env.DEMO_MODE === "true"
    ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
    : null;

export async function GET(request: NextRequest) {
  const session = demoSessionFor(request);
  if (session) {
    const internal = request.nextUrl.searchParams.get("scope") === "internal";
    if (internal && ["admin", "manager", "technical", "operational"].includes(session.role)) {
      return NextResponse.json(
        { demo: true, applications: listDemoRepresentativeApplications() },
        { headers: responseHeaders(request) }
      );
    }
    if (!session.roles.some((role) => role === "customer" || role === "representative")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: noStore });
    }
    return NextResponse.json(getDemoRepresentativeSnapshot(session.email), { headers: noStore });
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user) {
    return NextResponse.json(
      { message: "Entre para continuar." },
      { status: 401, headers: noStore }
    );
  }

  if (request.nextUrl.searchParams.get("scope") === "internal") {
    const { data, error } = await supabase
      .from("representative_applications")
      .select(
        "id,publicCode:public_code,status,currentStep:current_step,submittedAt:submitted_at,updatedAt:updated_at,userId:user_id"
      )
      .order("submitted_at", { ascending: false })
      .limit(100);
    return NextResponse.json(
      error ? { message: "Não foi possível carregar as solicitações." } : { applications: data },
      { status: error ? 403 : 200, headers: responseHeaders(request) }
    );
  }

  const [{ data: applicationRaw }, { data: representativeRaw }] = await Promise.all([
    supabase
      .from("representative_applications")
      .select("id,public_code,status,current_step,answers,decision_reason,updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("representatives")
      .select("id,public_code,referral_code,status,region_code,activated_at")
      .eq("user_id", user.id)
      .maybeSingle()
  ]);
  const application = isUnknownRecord(applicationRaw)
    ? {
        id: readString(applicationRaw, "id"),
        publicCode: readString(applicationRaw, "public_code"),
        status: readString(applicationRaw, "status"),
        currentStep: readNumber(applicationRaw, "current_step"),
        reason: readString(applicationRaw, "decision_reason"),
        updatedAt: readString(applicationRaw, "updated_at")
      }
    : null;
  const representativeRecord = isUnknownRecord(representativeRaw) ? representativeRaw : null;
  if (!representativeRecord) {
    return NextResponse.json(
      { demo: false, application, representative: null, sales: [], kitOrders: [], inventory: [] },
      { headers: noStore }
    );
  }
  const representativeId = readString(representativeRecord, "id");
  const [salesResult, kitOrdersResult, inventoryResult] = await Promise.all([
    supabase
      .from("representative_sales")
      .select("id,public_code,total_in_cents,status,sold_at")
      .eq("representative_id", representativeId)
      .order("sold_at", { ascending: false })
      .limit(100),
    supabase
      .from("kit_orders")
      .select("id,public_code,total_in_cents,status,kits(name)")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("representative_inventory")
      .select(
        "variant_id,quantity,product_variants!inner(sku,color_name,size,price_override,products!inner(name,base_price))"
      )
      .eq("representative_id", representativeId)
      .order("updated_at", { ascending: false })
      .limit(200)
  ]);
  const sales = readRows(salesResult.data).map((sale) => ({
    id: readString(sale, "id"),
    publicCode: readString(sale, "public_code"),
    totalInCents: readNumber(sale, "total_in_cents"),
    status: readString(sale, "status"),
    soldAt: readString(sale, "sold_at")
  }));
  const kitOrders = readRows(kitOrdersResult.data).map((order) => {
    const kit = isUnknownRecord(order.kits) ? order.kits : null;
    return {
      id: readString(order, "id"),
      publicCode: readString(order, "public_code"),
      kitName: kit ? readString(kit, "name", "Kit Curtiz") : "Kit Curtiz",
      totalInCents: readNumber(order, "total_in_cents"),
      status: readString(order, "status")
    };
  });
  const inventory = readRows(inventoryResult.data).map((entry) => {
    const variant = isUnknownRecord(entry.product_variants) ? entry.product_variants : null;
    const product = variant && isUnknownRecord(variant.products) ? variant.products : null;
    const override = variant ? readNumber(variant, "price_override", -1) : -1;
    return {
      variantId: readString(entry, "variant_id"),
      productName: product ? readString(product, "name", "Produto Curtiz") : "Produto Curtiz",
      sku: variant ? readString(variant, "sku") : "",
      color: variant ? readString(variant, "color_name") : "",
      size: variant ? readString(variant, "size") : "",
      priceInCents:
        override >= 0 ? Math.round(override * 100) : Math.round((product ? readNumber(product, "base_price") : 0) * 100),
      quantity: readNumber(entry, "quantity")
    };
  });
  return NextResponse.json(
    {
      demo: false,
      application,
      representative: {
        id: representativeId,
        publicCode: readString(representativeRecord, "public_code"),
        referralCode: readString(representativeRecord, "referral_code"),
        status: readString(representativeRecord, "status"),
        levelName: null,
        regionCode: readString(representativeRecord, "region_code"),
        activatedAt: readString(representativeRecord, "activated_at") || null
      },
      sales,
      kitOrders,
      inventory
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não autorizada." },
      { status: 403, headers: responseHeaders(request) }
    );
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Dados inválidos." }, { status: 400, headers: noStore });
  }

  const session = demoSessionFor(request);
  if (session) {
    try {
      const input = parsed.data;
      if (input.action === "save_draft") {
        const cpf =
          typeof input.values.cpf === "string" ? input.values.cpf.replace(/\D/gu, "") : "";
        const safeValues = { ...input.values };
        if (cpf) {
          delete safeValues.cpf;
          safeValues.cpfLastFour = cpf.slice(-4);
        }
        return NextResponse.json(saveDemoRepresentativeDraft(session, input.step, safeValues), {
          headers: responseHeaders(request)
        });
      }
      if (input.action === "submit") {
        return NextResponse.json(submitDemoRepresentativeApplication(session.email), {
          headers: noStore
        });
      }
      if (input.action === "review") {
        if (!["admin", "manager"].includes(session.role)) {
          return NextResponse.json(
            { message: "Acesso negado." },
            { status: 403, headers: noStore }
          );
        }
        return NextResponse.json(
          reviewDemoRepresentativeApplication(input.applicationId, input.decision, input.reason),
          { headers: responseHeaders(request) }
        );
      }
      if (input.action === "record_sale") {
        return NextResponse.json(recordDemoRepresentativeSale(session.email, input.items, input.idempotencyKey), {
          status: 201,
          headers: noStore
        });
      }
      registerDemoCreativeEvent(session.email, input.creativeId, input.eventType);
      return NextResponse.json({ ok: true }, { headers: noStore });
    } catch (error) {
      const known = error instanceof DemoRepresentativeError ? error : null;
      return NextResponse.json(
        { message: known?.message ?? "Não foi possível concluir a operação." },
        { status: known?.status ?? 500, headers: noStore }
      );
    }
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user) {
    return NextResponse.json(
      { message: "Entre para continuar." },
      { status: 401, headers: noStore }
    );
  }

  const input = parsed.data;
  if (input.action === "save_draft") {
    const existingResponse: unknown = await supabase
      .from("representative_applications")
      .select("id,answers,status")
      .eq("user_id", user.id)
      .maybeSingle();
    const existingData = readQueryResult(existingResponse).data;
    const existing = isUnknownRecord(existingData) ? existingData : null;
    const current = existing && isUnknownRecord(existing.answers) ? existing.answers : {};
    const cpf = typeof input.values.cpf === "string" ? input.values.cpf.replace(/\D/gu, "") : "";
    if (cpf && cpf.length !== 11) {
      return NextResponse.json({ message: "CPF inválido." }, { status: 422, headers: noStore });
    }
    const safeValues = { ...input.values };
    delete safeValues.cpf;
    let encryptedCpf: string | undefined;
    try {
      if (cpf) encryptedCpf = encryptPII(cpf);
    } catch {
      return NextResponse.json(
        { message: "Não foi possível proteger os dados pessoais." },
        { status: 503, headers: noStore }
      );
    }
    const payload = {
      user_id: user.id,
      current_step: Math.min(6, input.step + 1),
      answers: { ...current, [String(input.step)]: safeValues },
      ...(encryptedCpf ? { cpf_ciphertext: encryptedCpf, cpf_last_four: cpf.slice(-4) } : {}),
      ...(input.step === 5 && input.values.termsAccepted
        ? { terms_version: "representative-terms-v1", terms_accepted_at: new Date().toISOString() }
        : {})
    };
    const existingId = existing ? readString(existing, "id") : "";
    const query = existingId
      ? supabase.from("representative_applications").update(payload).eq("id", existingId)
      : supabase.from("representative_applications").insert(payload);
    const queryResponse: unknown = await query.select().single();
    const { data, error } = readQueryResult(queryResponse);
    return NextResponse.json(error ? { message: "Não foi possível salvar o rascunho." } : data, {
      status: error ? 409 : 200,
      headers: noStore
    });
  }
  if (input.action === "submit") {
    const applicationResponse: unknown = await supabase
      .from("representative_applications")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const applicationData = readQueryResult(applicationResponse).data;
    const application = isUnknownRecord(applicationData) ? applicationData : null;
    const applicationId = application ? readString(application, "id") : "";
    if (!applicationId) {
      return NextResponse.json(
        { message: "Solicitação não encontrada." },
        { status: 404, headers: noStore }
      );
    }
    const rpcResponse: unknown = await supabase.rpc("submit_representative_application", {
      p_application_id: applicationId
    });
    const { data, error } = readQueryResult(rpcResponse);
    return NextResponse.json(error ? { message: "Revise os dados antes de enviar." } : data, {
      status: error ? 422 : 200,
      headers: responseHeaders(request)
    });
  }
  if (input.action === "review") {
    const rpcResponse: unknown = await supabase.rpc("review_representative_application", {
      p_application_id: input.applicationId,
      p_decision: input.decision,
      p_reason: input.reason
    });
    const { data, error } = readQueryResult(rpcResponse);
    return NextResponse.json(error ? { message: "Decisão não permitida." } : data, {
      status: error ? 403 : 200,
      headers: responseHeaders(request)
    });
  }
  if (input.action === "record_sale") {
    const rpcResponse: unknown = await supabase.rpc("record_representative_sale", {
      p_idempotency_key: input.idempotencyKey,
      p_items: input.items,
      p_customer_reference: input.customerReference ?? null
    });
    const { data, error } = readQueryResult(rpcResponse);
    const sale = isUnknownRecord(data) ? data : null;
    if (error || !sale) {
      return NextResponse.json(
        { message: "A venda não foi registrada. Revise os itens e o estoque disponível." },
        { status: 409, headers: noStore }
      );
    }
    const rawTotal = sale.total_in_cents;
    return NextResponse.json(
      {
        id: readString(sale, "id"),
        publicCode: readString(sale, "public_code"),
        status: readString(sale, "status"),
        totalInCents:
          typeof rawTotal === "number" ? rawTotal : Number.parseInt(String(rawTotal), 10) || 0
      },
      { status: 201, headers: noStore }
    );
  }

  const representativeResponse: unknown = await supabase
    .from("representatives")
    .select("id")
    .eq("user_id", user.id)
    .single();
  const representativeData = readQueryResult(representativeResponse).data;
  const representative = isUnknownRecord(representativeData) ? representativeData : null;
  const representativeId = representative ? readString(representative, "id") : "";
  if (!representativeId) {
    return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: noStore });
  }
  const eventResponse: unknown = await supabase.from("creative_usage_events").insert({
    representative_id: representativeId,
    creative_id: input.creativeId,
    event_type: input.eventType,
    request_id: randomUUID()
  });
  const { error } = readQueryResult(eventResponse);
  return NextResponse.json(error ? { message: "Evento não registrado." } : { ok: true }, {
    status: error ? 403 : 200,
    headers: noStore
  });
}
