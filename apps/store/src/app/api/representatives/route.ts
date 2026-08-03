import { randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  cancelDemoRepresentativeSale,
  createDemoKitOrder,
  DemoRepresentativeError,
  getDemoRepresentativeSnapshot,
  listDemoRepresentativeApplications,
  markDemoRepresentativeNotification,
  recordDemoRepresentativeSale,
  registerDemoCreativeEvent,
  reviewDemoRepresentativeApplication,
  saveDemoRepresentativeDraft,
  submitDemoRepresentativeApplication,
  updateDemoRepresentativeProfile
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
    customerReference: z.string().trim().regex(/^[A-Za-z0-9._/-]+$/u).max(80).optional(),
    paymentMethod: z.enum(["pix", "card", "cash", "transfer", "other"]).optional(),
    notes: z.string().trim().max(500).optional(),
    soldAt: z.iso.datetime({ offset: true }).optional()
  }),
  z.object({
    action: z.literal("creative_event"),
    creativeId: z.string().min(1).max(120),
    eventType: z.enum(["view", "download", "copy", "favorite", "unfavorite", "share"])
  }),
  z.object({
    action: z.literal("update_profile"),
    regionCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/u)
  }),
  z.object({
    action: z.literal("buy_kit"),
    kitId: z.string().uuid(),
    idempotencyKey: z.string().uuid()
  }),
  z.object({
    action: z.literal("cancel_sale"),
    saleId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500)
  }),
  z.object({
    action: z.literal("mark_notification"),
    notificationId: z.string().uuid().or(z.string().startsWith("notification-demo-"))
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

  const [{ data: applicationRaw }, { data: representativeRaw, error: representativeError }] = await Promise.all([
    supabase
      .from("representative_applications")
      .select("id,public_code,status,current_step,answers,decision_reason,updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("representatives")
      .select(
        "id,user_id,public_code,referral_code,status,region_code,activated_at,current_level_id,representative_levels(name,description,rank)"
      )
      .eq("user_id", user.id)
      .maybeSingle()
  ]);
  if (representativeError) {
    return NextResponse.json(
      { message: "Não foi possível carregar o perfil de representante." },
      { status: 503, headers: noStore }
    );
  }
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
  const representativeStatus = readString(representativeRecord, "status");
  const levelId = readString(representativeRecord, "current_level_id");
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 20;
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;
  const networkSearch = request.nextUrl.searchParams.get("search")?.trim().slice(0, 80) || null;
  const networkStatus = request.nextUrl.searchParams.get("status")?.trim() || null;
  const goalsQuery = supabase
    .from("representative_goals")
    .select("id,title,period_start,period_end,target,active")
    .eq("active", true)
    .order("period_end", { ascending: true });
  const scopedGoalsQuery = levelId
    ? goalsQuery.or(`representative_id.eq.${representativeId},level_id.eq.${levelId}`)
    : goalsQuery.eq("representative_id", representativeId);
  const [
    profileResult,
    salesResult,
    kitOrdersResult,
    inventoryResult,
    movementsResult,
    availableKitsResult,
    qualificationResult,
    goalsResult,
    levelHistoryResult,
    commissionResult,
    paymentResult,
    documentsResult,
    contractsResult,
    trainingsResult,
    notificationsResult,
    networkResult,
    networkCountResult
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name,email_snapshot,phone,avatar_path")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("representative_sales")
      .select(
        "id,public_code,total_in_cents,status,sold_at,payment_method,notes,representative_sale_items(quantity,item_snapshot)",
        { count: "exact" }
      )
      .eq("representative_id", representativeId)
      .order("sold_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase
      .from("kit_orders")
      .select("id,public_code,total_in_cents,status,created_at,paid_at,shipped_at,delivered_at,kits(name)")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("representative_inventory")
      .select(
        "variant_id,quantity,product_variants!inner(sku,color_name,size,price_override,products!inner(name,base_price))"
      )
      .eq("representative_id", representativeId)
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("representative_inventory_movements")
      .select("id,variant_id,quantity_delta,reason,source_type,created_at")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("kits")
      .select("id,name,description,price_in_cents,required_for_activation,kit_level_rules(level_id,available,required)")
      .eq("active", true)
      .order("price_in_cents", { ascending: true })
      .limit(50),
    supabase
      .from("representative_qualifications")
      .select("id,qualified,period_start,period_end,metrics_snapshot,evaluated_at,qualification_rules(name,criteria)")
      .eq("representative_id", representativeId)
      .order("period_end", { ascending: false })
      .limit(24),
    scopedGoalsQuery.limit(50),
    supabase
      .from("representative_level_history")
      .select("id,reason,created_at,representative_levels!representative_level_history_new_level_id_fkey(name)")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(24),
    supabase
      .from("commission_entries")
      .select("id,status,eligible_amount_in_cents,commission_in_cents,created_at,representative_sales(public_code)")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("commission_payments")
      .select("id,amount_in_cents,status,paid_at,created_at")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("representative_documents")
      .select("id,document_type,storage_path,valid_until,created_at")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("representative_contracts")
      .select("id,version,storage_path,accepted_at")
      .eq("representative_id", representativeId)
      .order("accepted_at", { ascending: false })
      .limit(50),
    supabase
      .from("representative_trainings")
      .select("id,training_code,status,progress,completed_at")
      .eq("representative_id", representativeId)
      .order("training_code", { ascending: true })
      .limit(100),
    supabase
      .from("representative_notifications")
      .select("id,title,body,action_path,read_at,created_at")
      .eq("representative_id", representativeId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("get_representative_network", {
      p_search: networkSearch,
      p_status: networkStatus,
      p_limit: pageSize,
      p_offset: rangeFrom
    }),
    supabase
      .from("representative_network_closure")
      .select("descendant_id", { count: "exact", head: true })
      .eq("ancestor_id", representativeId)
      .gt("depth", 0)
  ]);
  const sales = readRows(salesResult.data).map((sale) => ({
    id: readString(sale, "id"),
    publicCode: readString(sale, "public_code"),
    totalInCents: readNumber(sale, "total_in_cents"),
    status: readString(sale, "status"),
    soldAt: readString(sale, "sold_at"),
    paymentMethod: readString(sale, "payment_method") || null,
    notes: readString(sale, "notes") || null,
    items: readRows(sale.representative_sale_items).map((item) => ({
      quantity: readNumber(item, "quantity"),
      snapshot: isUnknownRecord(item.item_snapshot) ? item.item_snapshot : {}
    }))
  }));
  const kitOrders = readRows(kitOrdersResult.data).map((order) => {
    const kit = isUnknownRecord(order.kits) ? order.kits : null;
    return {
      id: readString(order, "id"),
      publicCode: readString(order, "public_code"),
      kitName: kit ? readString(kit, "name", "Kit Curtiz") : "Kit Curtiz",
      totalInCents: readNumber(order, "total_in_cents"),
      status: readString(order, "status"),
      createdAt: readString(order, "created_at"),
      paidAt: readString(order, "paid_at") || null,
      shippedAt: readString(order, "shipped_at") || null,
      deliveredAt: readString(order, "delivered_at") || null
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
  const level = isUnknownRecord(representativeRecord.representative_levels)
    ? representativeRecord.representative_levels
    : null;
  const profile = isUnknownRecord(profileResult.data) ? profileResult.data : null;
  const availableKits = readRows(availableKitsResult.data)
    .filter((kit) => {
      const rules = readRows(kit.kit_level_rules);
      return (
        rules.length === 0 ||
        rules.some(
          (rule) =>
            readString(rule, "level_id") === levelId &&
            rule.available === true
        )
      );
    })
    .map((kit) => ({
      id: readString(kit, "id"),
      name: readString(kit, "name"),
      description: readString(kit, "description"),
      priceInCents: readNumber(kit, "price_in_cents"),
      requiredForActivation: kit.required_for_activation === true
    }));
  const qualifications = readRows(qualificationResult.data).map((item) => {
    const rule = isUnknownRecord(item.qualification_rules) ? item.qualification_rules : null;
    return {
      id: readString(item, "id"),
      name: rule ? readString(rule, "name") : "Regra vigente",
      qualified: item.qualified === true,
      periodStart: readString(item, "period_start"),
      periodEnd: readString(item, "period_end"),
      metrics: isUnknownRecord(item.metrics_snapshot) ? item.metrics_snapshot : {},
      criteria: rule && isUnknownRecord(rule.criteria) ? rule.criteria : {},
      evaluatedAt: readString(item, "evaluated_at")
    };
  });
  const goals = readRows(goalsResult.data).map((goal) => ({
    id: readString(goal, "id"),
    title: readString(goal, "title"),
    periodStart: readString(goal, "period_start"),
    periodEnd: readString(goal, "period_end"),
    target: isUnknownRecord(goal.target) ? goal.target : {}
  }));
  const levelHistory = readRows(levelHistoryResult.data).map((entry) => {
    const assignedLevel = isUnknownRecord(entry.representative_levels)
      ? entry.representative_levels
      : null;
    return {
      id: readString(entry, "id"),
      levelName: assignedLevel ? readString(assignedLevel, "name") : "Nível",
      reason: readString(entry, "reason"),
      createdAt: readString(entry, "created_at")
    };
  });
  const commissions = readRows(commissionResult.data).map((entry) => {
    const sale = isUnknownRecord(entry.representative_sales) ? entry.representative_sales : null;
    return {
      id: readString(entry, "id"),
      status: readString(entry, "status"),
      eligibleInCents: readNumber(entry, "eligible_amount_in_cents"),
      amountInCents: readNumber(entry, "commission_in_cents"),
      createdAt: readString(entry, "created_at"),
      saleCode: sale ? readString(sale, "public_code") : ""
    };
  });
  const payments = readRows(paymentResult.data).map((payment) => ({
    id: readString(payment, "id"),
    amountInCents: readNumber(payment, "amount_in_cents"),
    status: readString(payment, "status"),
    paidAt: readString(payment, "paid_at") || null,
    createdAt: readString(payment, "created_at")
  }));
  const inventoryMovements = readRows(movementsResult.data).map((movement) => ({
    id: readString(movement, "id"),
    variantId: readString(movement, "variant_id"),
    quantityDelta: readNumber(movement, "quantity_delta"),
    reason: readString(movement, "reason"),
    sourceType: readString(movement, "source_type"),
    createdAt: readString(movement, "created_at")
  }));
  const team = readRows(networkResult.data).map((member) => ({
    id: readString(member, "representative_id"),
    publicCode: readString(member, "public_code"),
    displayName: readString(member, "display_name"),
    status: readString(member, "status"),
    levelName: readString(member, "level_name") || null,
    depth: readNumber(member, "depth"),
    joinedAt: readString(member, "joined_at")
  }));
  const documents = await Promise.all(
    readRows(documentsResult.data).map(async (document) => {
      const path = readString(document, "storage_path");
      const signed = path
        ? await supabase.storage.from("representative-documents").createSignedUrl(path, 300)
        : null;
      return {
        id: readString(document, "id"),
        type: readString(document, "document_type"),
        validUntil: readString(document, "valid_until") || null,
        createdAt: readString(document, "created_at"),
        signedUrl: signed?.data?.signedUrl ?? null
      };
    })
  );
  const contracts = await Promise.all(
    readRows(contractsResult.data).map(async (contract) => {
      const path = readString(contract, "storage_path");
      const signed = path
        ? await supabase.storage.from("representative-documents").createSignedUrl(path, 300)
        : null;
      return {
        id: readString(contract, "id"),
        version: readString(contract, "version"),
        acceptedAt: readString(contract, "accepted_at"),
        signedUrl: signed?.data?.signedUrl ?? null
      };
    })
  );
  const trainings = readRows(trainingsResult.data).map((training) => ({
    id: readString(training, "id"),
    code: readString(training, "training_code"),
    status: readString(training, "status"),
    progress: readNumber(training, "progress"),
    completedAt: readString(training, "completed_at") || null
  }));
  const notifications = readRows(notificationsResult.data).map((notification) => ({
    id: readString(notification, "id"),
    title: readString(notification, "title"),
    body: readString(notification, "body"),
    actionPath: readString(notification, "action_path") || null,
    readAt: readString(notification, "read_at") || null,
    createdAt: readString(notification, "created_at")
  }));
  return NextResponse.json(
    {
      demo: false,
      application,
      representative: {
        id: representativeId,
        publicCode: readString(representativeRecord, "public_code"),
        referralCode: readString(representativeRecord, "referral_code"),
        status: readString(representativeRecord, "status"),
        levelName: level ? readString(level, "name") : null,
        levelDescription: level ? readString(level, "description") : null,
        fullName: profile ? readString(profile, "full_name") : "",
        email: profile ? readString(profile, "email_snapshot") : "",
        phone: profile ? readString(profile, "phone") || null : null,
        regionCode: readString(representativeRecord, "region_code"),
        activatedAt: readString(representativeRecord, "activated_at") || null
      },
      sales,
      kitOrders,
      inventory,
      inventoryMovements,
      availableKits,
      qualifications,
      goals,
      levelHistory,
      team,
      commissions,
      payments,
      documents,
      contracts,
      trainings,
      notifications,
      pagination: {
        sales: { page, pageSize, total: salesResult.count ?? sales.length },
        team: {
          page,
          pageSize,
          total: ["active", "unqualified", "approved_waiting_kit"].includes(representativeStatus)
            ? networkCountResult.count ?? team.length
            : 0
        }
      }
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
      if (input.action === "update_profile") {
        return NextResponse.json(
          updateDemoRepresentativeProfile(session.email, input.regionCode),
          { headers: noStore }
        );
      }
      if (input.action === "buy_kit") {
        return NextResponse.json(
          createDemoKitOrder(session.email, input.kitId, input.idempotencyKey),
          { status: 201, headers: noStore }
        );
      }
      if (input.action === "cancel_sale") {
        return NextResponse.json(cancelDemoRepresentativeSale(session.email, input.saleId), {
          headers: noStore
        });
      }
      if (input.action === "mark_notification") {
        return NextResponse.json(
          markDemoRepresentativeNotification(session.email, input.notificationId),
          { headers: noStore }
        );
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
    if (input.paymentMethod || input.notes || input.soldAt) {
      const metadataResponse: unknown = await supabase.rpc("set_representative_sale_metadata", {
        p_sale_id: readString(sale, "id"),
        p_payment_method: input.paymentMethod ?? null,
        p_notes: input.notes ?? null,
        p_sold_at: input.soldAt ?? null
      });
      if (readQueryResult(metadataResponse).error) {
        return NextResponse.json(
          {
            id: readString(sale, "id"),
            publicCode: readString(sale, "public_code"),
            status: readString(sale, "status"),
            warning:
              "A venda foi registrada, mas os dados complementares não foram aceitos."
          },
          { status: 207, headers: noStore }
        );
      }
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
  if (input.action === "update_profile") {
    const rpcResponse: unknown = await supabase.rpc("update_representative_profile", {
      p_region_code: input.regionCode
    });
    const { data, error } = readQueryResult(rpcResponse);
    return NextResponse.json(
      error ? { message: "Não foi possível atualizar o perfil." } : data,
      { status: error ? 422 : 200, headers: noStore }
    );
  }
  if (input.action === "buy_kit") {
    const rpcResponse: unknown = await supabase.rpc("create_representative_kit_order", {
      p_kit_id: input.kitId,
      p_idempotency_key: input.idempotencyKey
    });
    const { data, error } = readQueryResult(rpcResponse);
    return NextResponse.json(
      error ? { message: "Este kit não está disponível para seu perfil." } : data,
      { status: error ? 409 : 201, headers: noStore }
    );
  }
  if (input.action === "cancel_sale") {
    const rpcResponse: unknown = await supabase.rpc("cancel_representative_sale", {
      p_sale_id: input.saleId,
      p_reason: input.reason
    });
    const { data, error } = readQueryResult(rpcResponse);
    return NextResponse.json(
      error ? { message: "A venda não pode ser cancelada." } : data,
      { status: error ? 409 : 200, headers: noStore }
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
  if (input.action === "mark_notification") {
    const queryResponse: unknown = await supabase
      .from("representative_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", input.notificationId)
      .eq("representative_id", representativeId)
      .select("id")
      .maybeSingle();
    const { data, error } = readQueryResult(queryResponse);
    return NextResponse.json(
      error || !data ? { message: "Notificação não encontrada." } : { ok: true },
      { status: error || !data ? 404 : 200, headers: noStore }
    );
  }
  if (input.eventType === "favorite") {
    await supabase.from("creative_favorites").upsert({
      representative_id: representativeId,
      creative_id: input.creativeId
    });
  } else if (input.eventType === "unfavorite") {
    await supabase
      .from("creative_favorites")
      .delete()
      .eq("representative_id", representativeId)
      .eq("creative_id", input.creativeId);
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
