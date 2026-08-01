import {
  type SupportCategory,
  type SupportConversationView,
  type SupportMessageView,
  type SupportStatus,
  type SupportTeamMember
} from "@curtiz/domain";
import { randomUUID } from "node:crypto";

type DemoSupportRole = "customer" | "operational" | "admin" | "manager" | "technical";

export type DemoSupportActor = {
  email: string;
  fullName: string;
  role: DemoSupportRole;
};

type DemoSupportAgent = Omit<DemoSupportActor, "role"> & {
  role: Exclude<DemoSupportRole, "customer">;
};

type StoredConversation = SupportConversationView & {
  customerEmail: string;
  assignedEmail: string | null;
  requestId: string;
};

type DemoSupportState = {
  conversations: StoredConversation[];
};

const demoAgents: Record<Exclude<DemoSupportRole, "customer">, DemoSupportAgent> = {
  admin: {
    email: "admin.demo@curtiz.local",
    fullName: "Administrador Demo",
    role: "admin"
  },
  manager: {
    email: "gerencia.demo@curtiz.local",
    fullName: "Gerência Demo",
    role: "manager"
  },
  operational: {
    email: "operacional.demo@curtiz.local",
    fullName: "Operacional Demo",
    role: "operational"
  },
  technical: {
    email: "tecnico.demo@curtiz.local",
    fullName: "Técnico Demo",
    role: "technical"
  }
};

export function listDemoSupportTeam(): SupportTeamMember[] {
  return (["operational", "manager", "technical"] as const).map((role) => ({
    id: demoAgents[role].email,
    fullName: demoAgents[role].fullName,
    role,
    demo: true
  }));
}

const globalSupport = globalThis as typeof globalThis & {
  __curtizDemoSupport?: DemoSupportState;
};

const state = () => {
  globalSupport.__curtizDemoSupport ??= { conversations: [] };
  return globalSupport.__curtizDemoSupport;
};

export class DemoSupportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

const publicCode = () =>
  `ATD-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;

const canRead = (conversation: StoredConversation, actor: DemoSupportActor) => {
  if (actor.role === "customer") return conversation.customerEmail === actor.email;
  if (actor.role === "admin" || actor.role === "manager") return true;
  if (conversation.assignedEmail !== actor.email || conversation.assignedRole !== actor.role) {
    return false;
  }
  return actor.role !== "technical" || conversation.status === "escalated";
};

const toView = (
  conversation: StoredConversation,
  actor: DemoSupportActor
): SupportConversationView => ({
  id: conversation.id,
  publicCode: conversation.publicCode,
  subject: conversation.subject,
  category: conversation.category,
  priority: conversation.priority,
  status: conversation.status,
  customerName: actor.role === "customer" ? actor.fullName : conversation.customerName,
  relatedOrderCode: conversation.relatedOrderCode,
  assignedRole: conversation.assignedRole,
  assignedToCurrentUser: conversation.assignedEmail === actor.email,
  assignedName: conversation.assignedName,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  messages:
    actor.role === "customer"
      ? conversation.messages.filter((message) => message.author !== "internal")
      : conversation.messages
});

const findAccessible = (conversationId: string, actor: DemoSupportActor) => {
  const conversation = state().conversations.find((item) => item.id === conversationId);
  if (!conversation || !canRead(conversation, actor)) {
    throw new DemoSupportError("Atendimento não encontrado.", 404);
  }
  return conversation;
};

export function listDemoSupport(actor: DemoSupportActor): SupportConversationView[] {
  return state()
    .conversations.filter((conversation) => canRead(conversation, actor))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((conversation) => toView(conversation, actor));
}

export function createDemoSupport(
  actor: DemoSupportActor,
  input: {
    category: SupportCategory;
    message: string;
    orderCode?: string;
    requestId: string;
    subject: string;
  }
): SupportConversationView {
  if (actor.role !== "customer") {
    throw new DemoSupportError("Use uma conta de cliente para abrir um chamado.", 403);
  }
  const existing = state().conversations.find(
    (item) => item.customerEmail === actor.email && item.requestId === input.requestId
  );
  if (existing) return toView(existing, actor);

  const timestamp = now();
  const conversation: StoredConversation = {
    id: randomUUID(),
    publicCode: publicCode(),
    subject: input.subject,
    category: input.category,
    priority: input.category === "payment" || input.category === "technical" ? "high" : "normal",
    status: "queued",
    customerName: actor.fullName,
    customerEmail: actor.email,
    relatedOrderCode: input.orderCode?.trim() || null,
    assignedRole: "admin",
    assignedEmail: null,
    assignedToCurrentUser: false,
    assignedName: null,
    requestId: input.requestId,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: randomUUID(),
        author: "customer",
        content: input.message,
        createdAt: timestamp
      }
    ]
  };
  state().conversations.unshift(conversation);
  return toView(conversation, actor);
}

export function addDemoSupportMessage(
  actor: DemoSupportActor,
  conversationId: string,
  content: string,
  internal: boolean
) {
  const conversation = findAccessible(conversationId, actor);
  if (["closed", "cancelled", "spam"].includes(conversation.status)) {
    throw new DemoSupportError("Este atendimento não aceita novas mensagens.", 409);
  }
  if (actor.role === "customer" && internal) {
    throw new DemoSupportError("Operação não permitida.", 403);
  }
  if (
    actor.role !== "customer" &&
    actor.role !== "manager" &&
    conversation.assignedEmail !== actor.email
  ) {
    throw new DemoSupportError("Assuma o atendimento antes de responder.", 409);
  }
  if (internal && actor.role !== "admin" && actor.role !== "manager") {
    throw new DemoSupportError("Você não pode criar notas internas.", 403);
  }

  const createdAt = now();
  const message: SupportMessageView = {
    id: randomUUID(),
    author: internal ? "internal" : actor.role === "customer" ? "customer" : "team",
    content,
    createdAt
  };
  conversation.messages.push(message);
  conversation.updatedAt = createdAt;
  if (actor.role === "customer" && conversation.status === "waiting_customer") {
    conversation.status = "in_progress";
  } else if (actor.role !== "customer" && !internal) {
    conversation.status = "waiting_customer";
  }
  return toView(conversation, actor);
}

export function claimDemoSupport(actor: DemoSupportActor, conversationId: string) {
  if (actor.role !== "admin" && actor.role !== "manager") {
    throw new DemoSupportError("Seu perfil não pode assumir a fila administrativa.", 403);
  }
  const conversation = findAccessible(conversationId, actor);
  if (conversation.assignedEmail || !["open", "queued", "reopened"].includes(conversation.status)) {
    throw new DemoSupportError("Este atendimento já foi assumido.", 409);
  }
  conversation.assignedEmail = actor.email;
  conversation.assignedName = actor.fullName;
  conversation.assignedRole = actor.role;
  conversation.assignedToCurrentUser = true;
  conversation.status = "in_progress";
  conversation.updatedAt = now();
  return toView(conversation, actor);
}

export function transferDemoSupport(
  actor: DemoSupportActor,
  conversationId: string,
  targetRole: "operational" | "manager" | "technical",
  reason: string
) {
  const conversation = findAccessible(conversationId, actor);
  if (actor.role !== "manager" && conversation.assignedEmail !== actor.email) {
    throw new DemoSupportError("Somente o responsável ou a Gerência pode transferir.", 403);
  }
  if (reason.trim().length < 10) {
    throw new DemoSupportError("Informe um motivo com pelo menos 10 caracteres.", 400);
  }
  const target = demoAgents[targetRole];
  conversation.assignedEmail = target.email;
  conversation.assignedName = target.fullName;
  conversation.assignedRole = target.role;
  conversation.assignedToCurrentUser = target.email === actor.email;
  conversation.status = targetRole === "technical" ? "escalated" : "in_progress";
  conversation.updatedAt = now();
  conversation.messages.push({
    id: randomUUID(),
    author: "internal",
    content: `Transferência registrada: ${reason.trim()}`,
    createdAt: conversation.updatedAt
  });
  return toView(conversation, actor);
}

export function setDemoSupportStatus(
  actor: DemoSupportActor,
  conversationId: string,
  status: Extract<SupportStatus, "waiting_customer" | "resolved" | "closed" | "reopened">,
  reason: string
) {
  const conversation = findAccessible(conversationId, actor);
  if (actor.role !== "manager" && conversation.assignedEmail !== actor.email) {
    throw new DemoSupportError("Somente o responsável ou a Gerência pode alterar o status.", 403);
  }
  if (reason.trim().length < 5) {
    throw new DemoSupportError("Informe o motivo da alteração.", 400);
  }
  if (conversation.status === "closed" && status !== "reopened") {
    throw new DemoSupportError("Reabra o atendimento antes de alterar seu status.", 409);
  }
  conversation.status = status;
  conversation.updatedAt = now();
  return toView(conversation, actor);
}
