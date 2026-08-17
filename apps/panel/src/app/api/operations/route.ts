import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
const rows = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => Boolean(item)) : [];
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const number = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.parseInt(String(value), 10) || fallback;
const noStore = { "cache-control": "private, no-store" };

const orderStatuses = [
  "payment_approved",
  "processing",
  "picking",
  "ready_to_ship",
  "shipped",
  "delivered",
  "manual_review",
  "return_requested",
  "returned"
] as const;
const taskStatuses = ["queued", "in_progress", "blocked", "completed"] as const;
const returnStatuses = [
  "requested",
  "in_review",
  "approved",
  "waiting_posting",
  "in_transit",
  "received",
  "inspection",
  "exchange_sent",
  "refund_requested",
  "completed"
] as const;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_separation"), orderId: z.string().uuid() }),
  z.object({
    action: z.literal("start_dispatch"),
    orderId: z.string().uuid(),
    taskType: z.enum(["expedition", "shipping"])
  }),
  z.object({ action: z.literal("start_kit"), kitOrderId: z.string().uuid() }),
  z.object({ action: z.literal("claim_task"), taskId: z.string().uuid() }),
  z.object({
    action: z.literal("check_item"),
    taskItemId: z.string().uuid(),
    checkedQuantity: z.number().int().min(0).max(999),
    divergenceReason: z.string().trim().min(3).max(500).optional()
  }),
  z.object({
    action: z.literal("complete_task"),
    taskId: z.string().uuid(),
    notes: z.string().trim().max(1000).optional()
  }),
  z.object({
    action: z.literal("create_occurrence"),
    category: z.enum([
      "divergence",
      "damaged_product",
      "missing_item",
      "shipping",
      "invoice",
      "return",
      "exchange",
      "kit",
      "inventory",
      "customer_service",
      "other"
    ]),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    title: z.string().trim().min(5).max(120),
    description: z.string().trim().min(5).max(2000),
    orderId: z.string().uuid().optional(),
    kitOrderId: z.string().uuid().optional(),
    returnId: z.string().uuid().optional(),
    representativeId: z.string().uuid().optional(),
    supportConversationId: z.string().uuid().optional()
  }),
  z.object({
    action: z.literal("resolve_occurrence"),
    occurrenceId: z.string().uuid(),
    resolution: z.string().trim().min(3).max(2000),
    resolutionStatus: z.enum(["resolved", "rejected"])
  }),
  z.object({
    action: z.literal("request_adjustment"),
    variantId: z.string().uuid(),
    quantityDelta: z.number().int().min(-9999).max(9999).refine((value) => value !== 0),
    reason: z.string().trim().min(5).max(1000)
  }),
  z.object({
    action: z.literal("inspect_return"),
    returnItemId: z.string().uuid(),
    condition: z.string().trim().min(3).max(200),
    destination: z.enum(["sellable", "damaged", "discard", "supplier"]),
    result: z.string().trim().min(3).max(1000)
  }),
  z.object({
    action: z.literal("add_order_note"),
    orderId: z.string().uuid(),
    content: z.string().trim().min(3).max(1000)
  })
]);

const safeOrigin = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  const configured = [
    process.env.NEXT_PUBLIC_PANEL_URL,
    ...(process.env.ALLOWED_ORIGINS ?? "").split(",")
  ].filter(Boolean);
  return origin === requestOrigin || configured.includes(origin);
};

async function access(request: NextRequest) {
  const session = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (session) {
    return session?.role === "operational"
      ? { demo: true as const, supabase: null, userId: session.email }
      : null;
  }
  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user || userResult?.error) return null;
  const [{ data: profile }, { data: rolesData }] = await Promise.all([
    supabase.from("profiles").select("status").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id)
  ]);
  const roles = rows(rolesData).map((item) => text(item.role));
  if (profile?.status !== "active" || !roles.includes("operational")) return null;
  return { demo: false as const, supabase, userId: user.id };
}

const demoSnapshot = (section: string, page: number, pageSize: number) => ({
  ok: true,
  demo: true,
  section,
  capabilities: {
    executeTasks: false,
    fulfillKits: false,
    createOccurrences: false,
    resolveOccurrences: false,
    requestAdjustments: false,
    inspectReturns: false,
    addOrderNotes: false
  },
  metrics: {
    newOrders: 0,
    overdueOrders: 0,
    waitingSeparation: 0,
    waitingShipping: 0,
    pendingKits: 0,
    criticalStock: 0,
    exchanges: 0,
    returns: 0,
    occurrences: 0,
    support: 0,
    pendingTasks: 0
  },
  orders: [],
  tasks: [],
  inventory: [],
  movements: [],
  kitOrders: [],
  returns: [],
  occurrences: [],
  invoices: [],
  representatives: [],
  adjustments: [],
  pagination: { page, pageSize, total: 0 }
});

export async function GET(request: NextRequest) {
  const authorized = await access(request);
  if (!authorized) {
    return NextResponse.json({ ok: false, message: "Acesso negado." }, { status: 403, headers: noStore });
  }
  const section = request.nextUrl.searchParams.get("section")?.slice(0, 40) ?? "";
  const search =
    request.nextUrl.searchParams
      .get("q")
      ?.trim()
      .slice(0, 80)
      .replace(/[^\p{L}\p{N}\s#._-]/gu, "") ?? "";
  const status = request.nextUrl.searchParams.get("status")?.trim().slice(0, 40) ?? "";
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  if (authorized.demo) {
    return NextResponse.json(demoSnapshot(section, page, pageSize), { headers: noStore });
  }
  const supabase = authorized.supabase;
  const dashboard = section === "";
  const needsMetrics = dashboard || section === "relatorios-operacionais";
  const needsOrders = section === "pedidos";
  const needsTasks =
    dashboard || ["separacao", "expedicao", "envio", "pendencias"].includes(section);
  const needsInventory = ["estoque", "reposicao", "danificados"].includes(section);
  const needsKits = ["kits", "montagem-kits"].includes(section);
  const needsReturns = ["trocas", "devolucoes"].includes(section);
  const needsOccurrences = dashboard || ["ocorrencias", "pendencias"].includes(section);
  const needsInvoices = section === "notas-fiscais";
  const needsRepresentatives = section === "representantes";
  const emptyResult = () => Promise.resolve({ data: [], error: null, count: null });
  const metricsQuery = needsMetrics
    ? supabase.rpc("operational_dashboard_metrics")
    : Promise.resolve({ data: null, error: null });

  let orderQuery = supabase
    .from("orders")
    .select(
      "id,public_code,status,payment_status,customer_name_snapshot,shipping_address_snapshot,placed_at,created_at,order_items(id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity),shipments!shipments_order_id_fkey(id,status,provider,service,tracking_code,label_path,dispatched_at),order_status_history(previous_status,new_status,reason,created_at),order_notes(id,content_sanitized,created_at)",
      { count: "exact" }
    )
    .in("status", [...orderStatuses])
    .order("created_at", { ascending: false })
    .range(from, to);
  if (search) orderQuery = orderQuery.or(`public_code.ilike.%${search}%,customer_name_snapshot.ilike.%${search}%`);
  if (status && (orderStatuses as readonly string[]).includes(status)) orderQuery = orderQuery.eq("status", status);

  let taskQuery = supabase
    .from("operational_tasks")
    .select(
      "id,public_code,task_type,priority,status,assigned_to,due_at,started_at,completed_at,notes,created_at,orders(id,public_code,status,payment_status),kit_orders(id,public_code,status,kits(name)),returns(id,public_code,status),operational_task_items(id,expected_quantity,checked_quantity,divergence_reason,order_items(product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot),kit_order_items(item_snapshot))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status && (taskStatuses as readonly string[]).includes(status)) taskQuery = taskQuery.eq("status", status);
  const taskTypeForSection: Record<string, string> = {
    separacao: "separation",
    expedicao: "expedition",
    envio: "shipping",
    "montagem-kits": "kit_assembly"
  };
  if (taskTypeForSection[section]) {
    taskQuery = taskQuery.eq("task_type", taskTypeForSection[section]);
  }

  const inventoryFilter = section === "reposicao"
    ? "critical"
    : section === "danificados"
      ? "damaged"
      : "all";
  const inventoryQuery = supabase.rpc("operational_inventory_page", {
    p_query: search,
    p_filter: inventoryFilter,
    p_offset: from,
    p_limit: pageSize
  });
  const movementsQuery = supabase
    .from("inventory_movements")
    .select("id,variant_id,movement_type,quantity,previous_quantity,new_quantity,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const kitQuery = supabase
    .from("kit_orders")
    .select("id,public_code,status,created_at,updated_at,representatives(public_code),kits(name),kit_order_items(id,quantity,item_snapshot)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  let returnQuery = supabase
    .from("returns")
    .select("id,public_code,reason,description,requested_resolution,status,requested_at,orders(public_code),return_items(id,quantity,inspection_result,condition,restock_destination,resolution,order_items(product_name_snapshot,sku_snapshot))", { count: "exact" })
    .order("requested_at", { ascending: false })
    .range(from, to);
  if (status && (returnStatuses as readonly string[]).includes(status)) returnQuery = returnQuery.eq("status", status);
  if (section === "trocas") returnQuery = returnQuery.eq("requested_resolution", "exchange");
  const occurrenceQuery = supabase
    .from("operational_occurrences")
    .select("id,public_code,category,priority,status,title,description,resolution,assigned_to,order_id,kit_order_id,return_id,representative_id,created_at,updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  const invoiceQuery = supabase
    .from("erp_documents")
    .select("id,document_type,status,reference,error_summary,attempts,created_at,orders(public_code)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  const representativeQuery = supabase
    .from("representatives")
    .select("id,public_code,status,region_code,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  const adjustmentQuery = supabase
    .from("operational_inventory_adjustment_requests")
    .select("id,public_code,variant_id,quantity_delta,reason,status,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const capabilityCodes = [
    ...(["pedidos", "separacao", "expedicao", "envio", "kits", "montagem-kits", "pendencias"].includes(section)
      ? ["operations.tasks.execute"]
      : []),
    ...(section === "pedidos" ? ["orders.update_operational_status"] : []),
    ...(needsKits ? ["representatives.kits.fulfill"] : []),
    ...(needsInventory ? ["operations.inventory.request_adjustment"] : []),
    ...(needsReturns ? ["returns.inspect"] : []),
    ...(section === "ocorrencias"
      ? ["operations.occurrences.create", "operations.occurrences.resolve"]
      : [])
  ];
  const permissionPromise = Promise.all(
    capabilityCodes.map(async (permissionCode) => ({
      permissionCode,
      result: await supabase.rpc("has_permission", { permission_code: permissionCode })
    }))
  );

  const [
    metricsResult,
    ordersResult,
    tasksResult,
    inventoryResult,
    movementsResult,
    kitsResult,
    returnsResult,
    occurrencesResult,
    invoicesResult,
    representativesResult,
    adjustmentsResult,
    permissionResults
  ] = await Promise.all([
    metricsQuery,
    needsOrders ? orderQuery : emptyResult(),
    needsTasks ? taskQuery : emptyResult(),
    needsInventory ? inventoryQuery : emptyResult(),
    needsInventory ? movementsQuery : emptyResult(),
    needsKits ? kitQuery : emptyResult(),
    needsReturns ? returnQuery : emptyResult(),
    needsOccurrences ? occurrenceQuery : emptyResult(),
    needsInvoices ? invoiceQuery : emptyResult(),
    needsRepresentatives ? representativeQuery : emptyResult(),
    needsInventory ? adjustmentQuery : emptyResult(),
    permissionPromise
  ]);

  const sectionErrors: Record<string, Array<unknown>> = {
    pedidos: [ordersResult.error],
    separacao: [tasksResult.error],
    expedicao: [tasksResult.error],
    envio: [tasksResult.error],
    estoque: [inventoryResult.error],
    reposicao: [inventoryResult.error],
    danificados: [inventoryResult.error],
    kits: [kitsResult.error],
    "montagem-kits": [kitsResult.error, tasksResult.error],
    trocas: [returnsResult.error],
    devolucoes: [returnsResult.error],
    ocorrencias: [occurrencesResult.error],
    "notas-fiscais": [invoicesResult.error],
    representantes: [representativesResult.error],
    pendencias: [tasksResult.error, occurrencesResult.error]
  };
  const metricErrors = metricsResult.error ? [metricsResult.error] : [];
  const criticalError =
    sectionErrors[section]?.find(Boolean) ??
    (section === "relatorios-operacionais" ? metricErrors[0] : null);
  if (criticalError) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível carregar a operação." },
      { status: 503, headers: noStore }
    );
  }

  const maskedName = (value: string) => {
    const parts = value.trim().split(/\s+/u).filter(Boolean);
    return parts.length > 1 ? `${parts[0]} ${parts.at(-1)?.slice(0, 1)}.` : parts[0] ?? "Cliente";
  };
  const mapItems = (value: unknown) =>
    rows(value).map((item) => ({
      id: text(item.id),
      productName: text(item.product_name_snapshot) || text(record(item.item_snapshot)?.name),
      sku: text(item.sku_snapshot) || text(record(item.item_snapshot)?.sku),
      color: text(item.color_snapshot) || text(record(item.item_snapshot)?.color),
      size: text(item.size_snapshot) || text(record(item.item_snapshot)?.size),
      quantity: number(item.quantity)
    }));

  const orders = rows(ordersResult.data).map((order) => {
    const address = record(order.shipping_address_snapshot);
    return {
      id: text(order.id),
      publicCode: text(order.public_code),
      status: text(order.status),
      paymentConfirmed: text(order.payment_status) === "approved",
      customerName: maskedName(text(order.customer_name_snapshot)),
      address: address
        ? {
            line: [text(address.street), text(address.number)].filter(Boolean).join(", "),
            district: text(address.district),
            city: text(address.city),
            state: text(address.state),
            postalCode: text(address.postalCode) || text(address.postal_code)
          }
        : null,
      placedAt: text(order.placed_at) || text(order.created_at),
      items: mapItems(order.order_items),
      shipments: rows(order.shipments).map((shipment) => ({
        id: text(shipment.id),
        status: text(shipment.status),
        provider: text(shipment.provider),
        service: text(shipment.service),
        trackingCode: text(shipment.tracking_code) || null,
        labelReady: Boolean(text(shipment.label_path))
      })),
      history: rows(order.order_status_history).map((history) => ({
        status: text(history.new_status),
        reason: text(history.reason),
        createdAt: text(history.created_at)
      })),
      notes: rows(order.order_notes).map((note) => ({
        id: text(note.id),
        content: text(note.content_sanitized),
        createdAt: text(note.created_at)
      }))
    };
  });
  const tasks = rows(tasksResult.data).map((task) => {
    const sourceOrder = record(task.orders);
    const sourceKit = record(task.kit_orders);
    const sourceReturn = record(task.returns);
    return {
      id: text(task.id),
      publicCode: text(task.public_code),
      taskType: text(task.task_type),
      priority: text(task.priority),
      status: text(task.status),
      assignedToCurrentUser: text(task.assigned_to) === authorized.userId,
      assigned: Boolean(text(task.assigned_to)),
      dueAt: text(task.due_at) || null,
      startedAt: text(task.started_at) || null,
      createdAt: text(task.created_at),
      sourceCode:
        text(sourceOrder?.public_code) ||
        text(sourceKit?.public_code) ||
        text(sourceReturn?.public_code),
      sourceStatus: text(sourceOrder?.status) || text(sourceKit?.status) || text(sourceReturn?.status),
      items: rows(task.operational_task_items).map((item) => {
        const orderItem = record(item.order_items);
        const kitItem = record(item.kit_order_items);
        const snapshot = record(kitItem?.item_snapshot);
        return {
          id: text(item.id),
          productName: text(orderItem?.product_name_snapshot) || text(snapshot?.name, "Item"),
          sku: text(orderItem?.sku_snapshot) || text(snapshot?.sku),
          variant: [
            text(orderItem?.color_snapshot) || text(snapshot?.color),
            text(orderItem?.size_snapshot) || text(snapshot?.size)
          ].filter(Boolean).join(" · "),
          expectedQuantity: number(item.expected_quantity),
          checkedQuantity:
            typeof item.checked_quantity === "number" ? item.checked_quantity : null,
          divergenceReason: text(item.divergence_reason) || null
        };
      })
    };
  });
  const inventory = rows(inventoryResult.data).map((entry) => {
    return {
      variantId: text(entry.variant_id),
      productName: text(entry.product_name, "Produto"),
      sku: text(entry.sku),
      variant: [text(entry.color_name), text(entry.size)].filter(Boolean).join(" · "),
      available: number(entry.available_quantity),
      reserved: number(entry.reserved_quantity),
      damaged: number(entry.damaged_quantity),
      minimum: number(entry.minimum_quantity),
      ideal: number(entry.ideal_quantity),
      critical: entry.critical === true
    };
  });
  const kitOrders = rows(kitsResult.data).map((kit) => ({
    id: text(kit.id),
    publicCode: text(kit.public_code),
    status: text(kit.status),
    kitName: text(record(kit.kits)?.name, "Kit curti Z"),
    representativeCode: text(record(kit.representatives)?.public_code),
    createdAt: text(kit.created_at),
    items: mapItems(kit.kit_order_items)
  }));
  const returns = rows(returnsResult.data).map((returnRecord) => ({
    id: text(returnRecord.id),
    publicCode: text(returnRecord.public_code),
    orderCode: text(record(returnRecord.orders)?.public_code),
    reason: text(returnRecord.reason),
    description: text(returnRecord.description),
    requestedResolution: text(returnRecord.requested_resolution),
    status: text(returnRecord.status),
    requestedAt: text(returnRecord.requested_at),
    items: rows(returnRecord.return_items).map((item) => ({
      id: text(item.id),
      productName: text(record(item.order_items)?.product_name_snapshot, "Produto"),
      sku: text(record(item.order_items)?.sku_snapshot),
      quantity: number(item.quantity),
      condition: text(item.condition) || null,
      destination: text(item.restock_destination) || null,
      inspectionResult: text(item.inspection_result) || null
    }))
  }));
  const occurrences = rows(occurrencesResult.data).map((item) => ({
    id: text(item.id),
    publicCode: text(item.public_code),
    category: text(item.category),
    priority: text(item.priority),
    status: text(item.status),
    title: text(item.title),
    description: text(item.description),
    resolution: text(item.resolution) || null,
    assignedToCurrentUser: text(item.assigned_to) === authorized.userId,
    createdAt: text(item.created_at)
  }));
  const invoices = rows(invoicesResult.data).map((item) => ({
    id: text(item.id),
    orderCode: text(record(item.orders)?.public_code),
    type: text(item.document_type),
    status: text(item.status),
    reference: text(item.reference) || null,
    error: text(item.error_summary) || null,
    attempts: number(item.attempts),
    createdAt: text(item.created_at)
  }));
  const representatives = rows(representativesResult.data).map((item) => ({
    id: text(item.id),
    publicCode: text(item.public_code),
    status: text(item.status),
    regionCode: text(item.region_code) || null,
    createdAt: text(item.created_at)
  }));
  const adjustments = rows(adjustmentsResult.data).map((item) => ({
    id: text(item.id),
    publicCode: text(item.public_code),
    variantId: text(item.variant_id),
    quantityDelta: number(item.quantity_delta),
    reason: text(item.reason),
    status: text(item.status),
    createdAt: text(item.created_at)
  }));
  const movements = rows(movementsResult.data).map((item) => ({
    id: text(item.id),
    variantId: text(item.variant_id),
    type: text(item.movement_type),
    quantity: number(item.quantity),
    previous: number(item.previous_quantity),
    current: number(item.new_quantity),
    reason: text(item.reason),
    createdAt: text(item.created_at)
  }));

  const grantedCapabilities = new Set(
    permissionResults
      .filter(({ result }) => result.data === true && !result.error)
      .map(({ permissionCode }) => permissionCode)
  );
  const permission = (code: string) => grantedCapabilities.has(code);
  const capabilities = {
    executeTasks: permission("operations.tasks.execute"),
    fulfillKits: permission("representatives.kits.fulfill"),
    createOccurrences: permission("operations.occurrences.create"),
    resolveOccurrences: permission("operations.occurrences.resolve"),
    requestAdjustments: permission("operations.inventory.request_adjustment"),
    inspectReturns: permission("returns.inspect"),
    addOrderNotes: permission("orders.update_operational_status")
  };
  const metrics = record(metricsResult.data);
  const inventoryTotal = number(rows(inventoryResult.data)[0]?.total_count);
  const partialFailures = [
    ...metricErrors,
    ordersResult.error,
    tasksResult.error,
    inventoryResult.error,
    movementsResult.error,
    kitsResult.error,
    returnsResult.error,
    occurrencesResult.error,
    invoicesResult.error,
    representativesResult.error,
    adjustmentsResult.error,
    ...permissionResults.map(({ result }) => result.error)
  ].filter(Boolean);
  const sectionTotals: Record<string, number> = {
    pedidos: ordersResult.count ?? orders.length,
    separacao: tasksResult.count ?? tasks.length,
    expedicao: tasksResult.count ?? tasks.length,
    envio: tasksResult.count ?? tasks.length,
    estoque: inventoryTotal,
    reposicao: inventoryTotal,
    danificados: inventoryTotal,
    kits: kitsResult.count ?? kitOrders.length,
    "montagem-kits": kitsResult.count ?? kitOrders.length,
    trocas: returnsResult.count ?? returns.length,
    devolucoes: returnsResult.count ?? returns.length,
    ocorrencias: occurrencesResult.count ?? occurrences.length,
    "notas-fiscais": invoicesResult.count ?? invoices.length,
    representantes: representativesResult.count ?? representatives.length
  };
  return NextResponse.json(
    {
      ok: true,
      demo: false,
      section,
      capabilities,
      warning: partialFailures.length > 0
        ? "Alguns dados não puderam ser atualizados. Os blocos disponíveis continuam utilizáveis."
        : undefined,
      metrics: {
        newOrders: number(metrics?.newOrders),
        overdueOrders: number(metrics?.overdueOrders),
        waitingSeparation: number(metrics?.waitingSeparation),
        waitingShipping: number(metrics?.waitingShipping),
        pendingKits: number(metrics?.pendingKits),
        criticalStock: number(metrics?.criticalStock),
        exchanges: number(metrics?.exchanges),
        returns: number(metrics?.returns),
        occurrences: number(metrics?.occurrences),
        support: number(metrics?.support),
        pendingTasks: number(metrics?.pendingTasks)
      },
      orders,
      tasks,
      inventory,
      movements,
      kitOrders,
      returns,
      occurrences,
      invoices,
      representatives,
      adjustments,
      pagination: { page, pageSize, total: sectionTotals[section] ?? 0 }
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  if (!safeOrigin(request)) {
    return NextResponse.json({ ok: false, message: "Origem não autorizada." }, { status: 403, headers: noStore });
  }
  const authorized = await access(request);
  if (!authorized) {
    return NextResponse.json({ ok: false, message: "Acesso negado." }, { status: 403, headers: noStore });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Dados inválidos." }, { status: 400, headers: noStore });
  }
  if (authorized.demo) {
    return NextResponse.json(
      { ok: false, message: "Ações indisponíveis enquanto não houver dados conectados." },
      { status: 409, headers: noStore }
    );
  }
  const supabase = authorized.supabase;
  const input = parsed.data;
  let response: unknown;
  if (input.action === "start_separation") {
    response = await supabase.rpc("start_order_separation", { p_order_id: input.orderId });
  } else if (input.action === "start_dispatch") {
    response = await supabase.rpc("start_order_dispatch", {
      p_order_id: input.orderId,
      p_task_type: input.taskType
    });
  } else if (input.action === "start_kit") {
    response = await supabase.rpc("start_kit_assembly", { p_kit_order_id: input.kitOrderId });
  } else if (input.action === "claim_task") {
    response = await supabase.rpc("claim_operational_task", { p_task_id: input.taskId });
  } else if (input.action === "check_item") {
    response = await supabase.rpc("check_operational_task_item", {
      p_task_item_id: input.taskItemId,
      p_checked_quantity: input.checkedQuantity,
      p_divergence_reason: input.divergenceReason ?? null
    });
  } else if (input.action === "complete_task") {
    response = await supabase.rpc("complete_operational_task", {
      p_task_id: input.taskId,
      p_notes: input.notes ?? null
    });
  } else if (input.action === "create_occurrence") {
    response = await supabase.rpc("create_operational_occurrence", {
      p_category: input.category,
      p_priority: input.priority,
      p_title: input.title,
      p_description: input.description,
      p_order_id: input.orderId ?? null,
      p_kit_order_id: input.kitOrderId ?? null,
      p_return_id: input.returnId ?? null,
      p_representative_id: input.representativeId ?? null,
      p_support_conversation_id: input.supportConversationId ?? null
    });
  } else if (input.action === "resolve_occurrence") {
    response = await supabase.rpc("resolve_operational_occurrence", {
      p_occurrence_id: input.occurrenceId,
      p_resolution: input.resolution,
      p_status: input.resolutionStatus
    });
  } else if (input.action === "request_adjustment") {
    response = await supabase.rpc("request_operational_inventory_adjustment", {
      p_variant_id: input.variantId,
      p_quantity_delta: input.quantityDelta,
      p_reason: input.reason
    });
  } else if (input.action === "inspect_return") {
    response = await supabase.rpc("inspect_operational_return_item", {
      p_return_item_id: input.returnItemId,
      p_condition: input.condition,
      p_destination: input.destination,
      p_result: input.result
    });
  } else {
    response = await supabase.rpc("add_operational_order_note", {
      p_order_id: input.orderId,
      p_content: input.content
    });
  }
  const result = record(response);
  const error = record(result?.error);
  if (error) {
    const code = text(error.code);
    const forbidden = code === "42501";
    return NextResponse.json(
      { ok: false, message: forbidden ? "Sua permissão não permite esta operação." : "A operação não pôde ser concluída no estado atual." },
      { status: forbidden ? 403 : code === "P0002" ? 404 : 409, headers: noStore }
    );
  }
  return NextResponse.json({ ok: true, data: result?.data ?? null }, { headers: noStore });
}
