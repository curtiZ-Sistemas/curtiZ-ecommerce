import {
  supportCategories,
  supportStatuses,
  type SupportCategory,
  type SupportConversationView,
  type SupportPriority,
  type SupportStatus,
  type SupportTeamMember
} from "@curtiz/domain";
import {
  DEMO_SESSION_COOKIE,
  sanitizePlainText,
  verifyDemoSession
} from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addDemoSupportMessage,
  claimDemoSupport,
  createDemoSupport,
  DemoSupportError,
  type DemoSupportActor,
  listDemoSupportTeam,
  listDemoSupport,
  setDemoSupportStatus,
  transferDemoSupport
} from "@/lib/demo-support-store";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult, readRows, readString } from "@/lib/unknown-data";

const createSchema = z.object({
  action: z.literal("create"),
  category: z.enum(supportCategories),
  subject: z.string().trim().min(5).max(120),
  message: z.string().trim().min(10).max(4_000),
  orderCode: z.string().trim().max(40).optional(),
  requestId: z.string().uuid()
});

const messageSchema = z.object({
  action: z.literal("message"),
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4_000),
  internal: z.boolean().default(false)
});

const claimSchema = z.object({
  action: z.literal("claim"),
  conversationId: z.string().uuid()
});

const transferSchema = z.object({
  action: z.literal("transfer"),
  conversationId: z.string().uuid(),
  targetRole: z.enum(["operational", "manager", "technical"]),
  targetUserId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).max(500)
});

const statusSchema = z.object({
  action: z.literal("status"),
  conversationId: z.string().uuid(),
  status: z.enum(["waiting_customer", "resolved", "closed", "reopened"]),
  reason: z.string().trim().min(5).max(500)
});

const writeSchema = z.discriminatedUnion("action", [createSchema, messageSchema]);
const updateSchema = z.discriminatedUnion("action", [claimSchema, transferSchema, statusSchema]);

type AppRole = "customer" | "operational" | "admin" | "manager" | "technical";

type SupportActor = {
  kind: "demo" | "supabase";
  email: string;
  fullName: string;
  role: AppRole;
  userId: string | null;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

const categoryByDatabaseSlug: Record<string, SupportCategory> = {
  pedido: "order",
  pagamento: "payment",
  entrega: "delivery",
  "troca-devolucao": "return",
  produto: "product",
  conta: "account",
  "problema-tecnico": "technical",
  outro: "other"
};

const allowedOrigins = () =>
  new Set(
    [
      process.env.NEXT_PUBLIC_STORE_URL,
      process.env.NEXT_PUBLIC_PANEL_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001"
    ].filter((origin): origin is string => Boolean(origin))
  );

const originIsAllowed = (request: Request, origin: string) => {
  if (allowedOrigins().has(origin)) return true;
  if (process.env.DEMO_MODE !== "true") return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return (
      requestUrl.hostname === originUrl.hostname &&
      (originUrl.port === "3000" || originUrl.port === "3001")
    );
  } catch {
    return false;
  }
};

const isAllowedOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || originIsAllowed(request, origin);
};

const responseHeaders = (request: Request) => {
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  const origin = request.headers.get("origin");
  if (origin && originIsAllowed(request, origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-methods"] = "GET, POST, PATCH, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers.vary = "Origin";
  }
  return headers;
};

const json = (request: Request, body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: responseHeaders(request) });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nestedString = (value: unknown, key: string): string | null => {
  const record = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  return typeof record?.[key] === "string" ? record[key] : null;
};

async function getActor(request: NextRequest): Promise<SupportActor | null> {
  const demoSession = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demoSession) {
    return {
      kind: "demo",
      email: demoSession.email,
      fullName: demoSession.fullName,
      role: demoSession.role === "representative" ? "customer" : demoSession.role,
      userId: null,
      supabase: null
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const roleResponse: unknown = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id);
  const roleValue = readRows(readQueryResult(roleResponse).data)
    .map((item) => readString(item, "role"))
    .find((role) => ["operational", "admin", "manager", "technical"].includes(role));
  const role: AppRole =
    roleValue === "operational" ||
    roleValue === "admin" ||
    roleValue === "manager" ||
    roleValue === "technical"
      ? roleValue
      : "customer";
  const metadataName: unknown = data.user.user_metadata.full_name;
  return {
    kind: "supabase",
    email: data.user.email ?? "",
    fullName: typeof metadataName === "string" ? metadataName : "Cliente Curtiz",
    role,
    userId: data.user.id,
    supabase
  };
}

const demoActor = (actor: SupportActor): DemoSupportActor => ({
  email: actor.email,
  fullName: actor.fullName,
  role: actor.role
});

async function listSupabaseSupport(actor: SupportActor): Promise<SupportConversationView[]> {
  if (!actor.supabase || !actor.userId) return [];
  const { data, error } = await actor.supabase
    .from("support_conversations")
    .select(
      "id,public_code,subject,priority,status,assigned_role,assigned_user_id,created_at,updated_at,support_categories(slug),orders(public_code)"
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("support_read_failed");

  const conversationRows = Array.isArray(data) ? data.map(asRecord).filter(Boolean) : [];
  const ids = conversationRows
    .map((row) => (typeof row?.id === "string" ? row.id : null))
    .filter((id): id is string => Boolean(id));
  const messagesByConversation = new Map<string, SupportConversationView["messages"]>();

  if (ids.length) {
    const { data: messageData, error: messageError } = await actor.supabase
      .from("support_messages")
      .select("id,conversation_id,sender_role,content_sanitized,is_internal_note,created_at")
      .in("conversation_id", ids)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (messageError) throw new Error("support_messages_read_failed");
    for (const rawMessage of Array.isArray(messageData) ? messageData : []) {
      const message = asRecord(rawMessage);
      if (!message || typeof message.conversation_id !== "string") continue;
      const current = messagesByConversation.get(message.conversation_id) ?? [];
      current.push({
        id: typeof message.id === "string" ? message.id : "",
        author:
          message.is_internal_note === true
            ? "internal"
            : message.sender_role === "customer"
              ? "customer"
              : "team",
        content: typeof message.content_sanitized === "string" ? message.content_sanitized : "",
        createdAt:
          typeof message.created_at === "string" ? message.created_at : new Date(0).toISOString()
      });
      messagesByConversation.set(message.conversation_id, current);
    }
  }

  return conversationRows.flatMap((row) => {
    if (!row || typeof row.id !== "string" || typeof row.public_code !== "string") return [];
    const rawStatus = typeof row.status === "string" ? row.status : "queued";
    const status: SupportStatus = (supportStatuses as readonly string[]).includes(rawStatus)
      ? (rawStatus as SupportStatus)
      : "queued";
    const rawPriority = typeof row.priority === "string" ? row.priority : "normal";
    const priority: SupportPriority = ["low", "normal", "high", "urgent"].includes(rawPriority)
      ? (rawPriority as SupportPriority)
      : "normal";
    const rawAssignedRole = typeof row.assigned_role === "string" ? row.assigned_role : "admin";
    const assignedRole =
      rawAssignedRole === "operational" ||
      rawAssignedRole === "manager" ||
      rawAssignedRole === "technical"
        ? rawAssignedRole
        : "admin";
    const databaseCategory = nestedString(row.support_categories, "slug") ?? "outro";
    return [
      {
        id: row.id,
        publicCode: row.public_code,
        subject: typeof row.subject === "string" ? row.subject : "Atendimento",
        category: categoryByDatabaseSlug[databaseCategory] ?? "other",
        priority,
        status,
        customerName: actor.role === "customer" ? actor.fullName : "Cliente protegido",
        relatedOrderCode: nestedString(row.orders, "public_code"),
        assignedRole,
        assignedToCurrentUser: row.assigned_user_id === actor.userId,
        assignedName: row.assigned_user_id ? "Responsável atribuído" : null,
        createdAt:
          typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
        updatedAt:
          typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
        messages: messagesByConversation.get(row.id) ?? []
      } satisfies SupportConversationView
    ];
  });
}

async function listSupport(actor: SupportActor) {
  return actor.kind === "demo"
    ? listDemoSupport(demoActor(actor))
    : listSupabaseSupport(actor);
}

async function listSupportTeam(actor: SupportActor): Promise<SupportTeamMember[]> {
  if (actor.role !== "admin" && actor.role !== "manager") return [];
  if (actor.kind === "demo") return listDemoSupportTeam();
  if (!actor.supabase) return [];
  const rpcResult = asRecord(
    (await actor.supabase.rpc("list_support_transfer_targets")) as unknown
  );
  if (rpcResult?.error) throw new Error("support_team_read_failed");
  const rpcData = rpcResult?.data;
  return (Array.isArray(rpcData) ? rpcData : []).flatMap((raw) => {
    const row = asRecord(raw);
    if (
      !row ||
      typeof row.user_id !== "string" ||
      typeof row.full_name !== "string" ||
      (row.role !== "operational" && row.role !== "manager" && row.role !== "technical")
    ) {
      return [];
    }
    return [{ id: row.user_id, fullName: row.full_name, role: row.role, demo: false }];
  });
}

function publicError(request: Request, error: unknown) {
  if (error instanceof DemoSupportError) {
    return json(request, { ok: false, message: error.message }, error.status);
  }
  return json(
    request,
    { ok: false, message: "Não foi possível concluir o atendimento agora. Tente novamente." },
    500
  );
}

export function OPTIONS(request: Request) {
  return isAllowedOrigin(request)
    ? new NextResponse(null, { status: 204, headers: responseHeaders(request) })
    : new NextResponse(null, { status: 403 });
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) return json(request, { ok: false }, 403);
  const actor = await getActor(request);
  if (!actor) {
    return json(
      request,
      { ok: false, requiresAuthentication: true, message: "Entre para acessar seus chamados." },
      401
    );
  }
  try {
    const [conversations, team] = await Promise.all([
      listSupport(actor),
      listSupportTeam(actor)
    ]);
    return json(request, { ok: true, conversations, team });
  } catch (error) {
    return publicError(request, error);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) return json(request, { ok: false }, 403);
  const actor = await getActor(request);
  if (!actor) {
    return json(
      request,
      { ok: false, requiresAuthentication: true, message: "Entre para continuar." },
      401
    );
  }
  const parsed = writeSchema.safeParse(await request.json());
  if (!parsed.success) return json(request, { ok: false, message: "Revise os dados informados." }, 400);

  try {
    if (parsed.data.action === "create") {
      if (actor.role !== "customer") {
        return json(request, { ok: false, message: "Use uma conta de cliente." }, 403);
      }
      const message = sanitizePlainText(parsed.data.message);
      const subject = sanitizePlainText(parsed.data.subject, 120);
      if (message.length < 10 || subject.length < 5) {
        return json(request, { ok: false, message: "Revise o assunto e a mensagem." }, 400);
      }
      let conversation: SupportConversationView | undefined;
      if (actor.kind === "demo") {
        conversation = createDemoSupport(demoActor(actor), {
          category: parsed.data.category,
          message,
          orderCode: parsed.data.orderCode,
          requestId: parsed.data.requestId,
          subject
        });
      } else if (actor.supabase) {
        const rpcResult = asRecord(
          (await actor.supabase.rpc("create_support_conversation", {
            p_category: parsed.data.category,
            p_subject: subject,
            p_initial_message: message,
            p_related_order_code: parsed.data.orderCode || null,
            p_client_request_id: parsed.data.requestId
          })) as unknown
        );
        if (rpcResult?.error) throw new Error("support_create_failed");
        const rpcData = rpcResult?.data;
        const created = Array.isArray(rpcData) ? asRecord(rpcData[0]) : asRecord(rpcData);
        const conversations = await listSupport(actor);
        conversation = conversations.find((item) => item.id === created?.id);
      }
      if (!conversation) throw new Error("support_create_missing");
      return json(
        request,
        {
          ok: true,
          conversation,
          message:
            "Seu chamado foi enviado. Nosso atendimento humano pode levar de 1 a 3 horas para responder."
        },
        201
      );
    }

    const content = sanitizePlainText(parsed.data.message);
    if (!content) return json(request, { ok: false, message: "A mensagem está vazia." }, 400);
    if (actor.kind === "demo") {
      addDemoSupportMessage(
        demoActor(actor),
        parsed.data.conversationId,
        content,
        parsed.data.internal
      );
    } else if (actor.supabase && actor.userId) {
      const { error } = await actor.supabase.from("support_messages").insert({
        conversation_id: parsed.data.conversationId,
        sender_id: actor.userId,
        sender_role: actor.role,
        content_sanitized: content,
        is_internal_note: parsed.data.internal
      });
      if (error) throw new Error("support_message_failed");
    }
    return json(request, { ok: true, conversations: await listSupport(actor) }, 201);
  } catch (error) {
    return publicError(request, error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedOrigin(request)) return json(request, { ok: false }, 403);
  const actor = await getActor(request);
  if (!actor || actor.role === "customer") {
    return json(request, { ok: false, message: "Operação não permitida." }, 403);
  }
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return json(request, { ok: false, message: "Revise a operação." }, 400);

  try {
    if (parsed.data.action === "claim") {
      if (actor.kind === "demo") {
        claimDemoSupport(demoActor(actor), parsed.data.conversationId);
      } else if (actor.supabase) {
        const { error } = await actor.supabase.rpc("claim_support_conversation", {
          p_conversation_id: parsed.data.conversationId
        });
        if (error) {
          return json(request, { ok: false, message: "Este atendimento já foi assumido." }, 409);
        }
      }
    } else if (parsed.data.action === "transfer") {
      if (actor.kind === "demo") {
        transferDemoSupport(
          demoActor(actor),
          parsed.data.conversationId,
          parsed.data.targetRole,
          parsed.data.reason
        );
      } else if (actor.supabase) {
        if (!parsed.data.targetUserId) {
          return json(request, { ok: false, message: "Selecione o colaborador responsável." }, 400);
        }
        const { error } = await actor.supabase.rpc("transfer_support_conversation", {
          p_conversation_id: parsed.data.conversationId,
          p_target_user_id: parsed.data.targetUserId,
          p_target_role: parsed.data.targetRole,
          p_reason: sanitizePlainText(parsed.data.reason, 500)
        });
        if (error) throw new Error("support_transfer_failed");
      }
    } else if (actor.kind === "demo") {
      setDemoSupportStatus(
        demoActor(actor),
        parsed.data.conversationId,
        parsed.data.status,
        parsed.data.reason
      );
    } else if (actor.supabase) {
      const { error } = await actor.supabase.rpc("set_support_conversation_status", {
        p_conversation_id: parsed.data.conversationId,
        p_status: parsed.data.status,
        p_reason: sanitizePlainText(parsed.data.reason, 500)
      });
      if (error) throw new Error("support_status_failed");
    }

    return json(request, { ok: true, conversations: await listSupport(actor) });
  } catch (error) {
    return publicError(request, error);
  }
}
