import type {
  CreativeStatus,
  RepresentativeApplicationStatus,
  RepresentativeStatus
} from "@curtiz/domain";
import { randomUUID } from "node:crypto";

export type DemoRepresentativeApplication = {
  id: string;
  publicCode: string;
  email: string;
  fullName: string;
  status: RepresentativeApplicationStatus;
  currentStep: number;
  steps: Record<string, Record<string, string | boolean>>;
  reason?: string;
  updatedAt: string;
};

export type DemoRepresentative = {
  id: string;
  email: string;
  fullName: string;
  publicCode: string;
  referralCode: string;
  status: RepresentativeStatus;
  levelName: string | null;
  regionCode: string;
  activatedAt: string | null;
};

export type DemoCreative = {
  id: string;
  title: string;
  campaign: string;
  type: "image" | "video" | "caption";
  platform: string;
  status: CreativeStatus;
  caption: string;
  publishedAt: string;
  demo: true;
};

type DemoState = {
  applications: DemoRepresentativeApplication[];
  representatives: DemoRepresentative[];
  kitOrders: Array<{
    id: string;
    publicCode: string;
    representativeId: string;
    kitName: string;
    status: string;
    totalInCents: number;
  }>;
  sales: Array<{
    id: string;
    publicCode: string;
    representativeId: string;
    totalInCents: number;
    status: string;
    soldAt: string;
    idempotencyKey: string;
    items: Array<{ variantId: string; quantity: number }>;
  }>;
  inventory: Array<{
    representativeId: string;
    variantId: string;
    productName: string;
    sku: string;
    color: string;
    size: string;
    priceInCents: number;
    quantity: number;
  }>;
  creatives: DemoCreative[];
  creativeEvents: Array<{ creativeId: string; representativeId: string; type: string }>;
  notifications: Array<{
    id: string;
    representativeId: string;
    title: string;
    body: string;
    actionPath: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
};

const demoRules = {
  approvalMode: "simple" as const,
  kitActivationRequired: true,
  commission: { version: 1, basisPoints: 0 },
  qualifications: [] as Array<Record<string, unknown>>
};

const globalState = globalThis as typeof globalThis & { __curtizDemoRepresentatives?: DemoState };
const now = () => new Date().toISOString();
const code = (prefix: string) =>
  `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;

const demoInventory = [
  {
    representativeId: "demo-representative",
    variantId: "10000000-0000-4000-8000-000000000001",
    productName: "curti Z Flip-Flop Wave Preto",
    sku: "CZT-FW-PRE-40",
    color: "Preto",
    size: "39/40",
    priceInCents: 5990,
    quantity: 6
  },
  {
    representativeId: "demo-representative",
    variantId: "10000000-0000-4000-8000-000000000002",
    productName: "curti Z Slide Comfort Bege",
    sku: "CZT-SC-BEG-38",
    color: "Bege",
    size: "37/38",
    priceInCents: 7490,
    quantity: 4
  }
];

const state = (): DemoState => {
  globalState.__curtizDemoRepresentatives ??= {
    applications: [
      {
        id: "demo-approved-application",
        publicCode: "SOL-DEMO001",
        email: "representante.demo@curtiz.local",
        fullName: "Representante Demo",
        status: "approved",
        currentStep: 6,
        steps: {},
        updatedAt: now()
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        publicCode: "SOL-DEMO002",
        email: "candidata.demo@curtiz.local",
        fullName: "Candidata Demo",
        status: "submitted",
        currentStep: 6,
        steps: {},
        updatedAt: now()
      }
    ],
    representatives: [
      {
        id: "demo-representative",
        email: "representante.demo@curtiz.local",
        fullName: "Representante Demo",
        publicCode: "REP-DEMO001",
        referralCode: "CURTIZDEMO",
        status: "active",
        levelName: null,
        regionCode: "SP",
        activatedAt: now()
      }
    ],
    kitOrders: [],
    sales: [],
    inventory: demoInventory.map((item) => ({ ...item })),
    creatives: [
      {
        id: "creative-demo-1",
        title: "Apresentação da coleção",
        campaign: "Coleção demonstrativa",
        type: "caption",
        platform: "Instagram",
        status: "published",
        caption: "Conheça a seleção curti Z disponível para demonstração.",
        publishedAt: now(),
        demo: true
      },
      {
        id: "creative-demo-2",
        title: "Guia de produto",
        campaign: "Materiais permanentes",
        type: "image",
        platform: "WhatsApp",
        status: "published",
        caption: "Material visual demonstrativo; substitua pelo ativo aprovado antes de publicar.",
        publishedAt: now(),
        demo: true
      }
    ],
    creativeEvents: [],
    notifications: [
      {
        id: "notification-demo-1",
        representativeId: "demo-representative",
        title: "Portal demonstrativo disponível",
        body: "Os dados desta conta são fictícios e servem apenas para validação do fluxo.",
        actionPath: null,
        readAt: null,
        createdAt: now()
      }
    ]
  };
  globalState.__curtizDemoRepresentatives.inventory ??= demoInventory.map((item) => ({ ...item }));
  return globalState.__curtizDemoRepresentatives;
};

export class DemoRepresentativeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const getDemoRepresentativeSnapshot = (email: string) => {
  const application = state().applications.find((item) => item.email === email) ?? null;
  const representative = state().representatives.find((item) => item.email === email) ?? null;
  return {
    demo: true as const,
    application,
    representative,
    rules: demoRules,
    kitOrders: representative
      ? state().kitOrders.filter((item) => item.representativeId === representative.id)
      : [],
    sales: representative
      ? state().sales.filter((item) => item.representativeId === representative.id)
      : [],
    inventory: representative
      ? state().inventory.filter((item) => item.representativeId === representative.id)
      : [],
    inventoryMovements: [],
    creatives: representative ? state().creatives.filter((item) => item.status === "published") : [],
    availableKits: representative
      ? [
          {
            id: "20000000-0000-4000-8000-000000000001",
            name: "Kit demonstrativo curti Z",
            description: "Oferta fictícia para validar o fluxo de compra em ambiente demo.",
            priceInCents: 19990,
            requiredForActivation: false,
            demo: true as const
          }
        ]
      : [],
    qualifications: [],
    goals: [],
    levelHistory: [],
    team: [],
    commissions: [],
    payments: [],
    documents: [],
    contracts: [],
    trainings: [],
    notifications: representative
      ? state().notifications.filter((item) => item.representativeId === representative.id)
      : [],
    pagination: { sales: { page: 1, pageSize: 20, total: 0 }, team: { page: 1, pageSize: 20, total: 0 } }
  };
};

export const listDemoRepresentativeApplications = () =>
  state().applications.map((application) => ({
    ...application,
    steps: undefined
  }));

export const saveDemoRepresentativeDraft = (
  actor: { email: string; fullName: string },
  step: number,
  values: Record<string, string | boolean>
) => {
  if (!Number.isInteger(step) || step < 1 || step > 6) {
    throw new DemoRepresentativeError("Etapa inválida.", 400);
  }
  const existing = state().applications.find((item) => item.email === actor.email);
  if (existing && !["draft", "documents_pending"].includes(existing.status)) {
    throw new DemoRepresentativeError("Esta solicitação não pode mais ser editada.", 409);
  }
  const application = existing ?? {
    id: randomUUID(),
    publicCode: code("SOL"),
    email: actor.email,
    fullName: actor.fullName,
    status: "draft" as const,
    currentStep: 1,
    steps: {},
    updatedAt: now()
  };
  application.steps[String(step)] = values;
  application.currentStep = Math.max(application.currentStep, Math.min(6, step + 1));
  application.updatedAt = now();
  if (!existing) state().applications.push(application);
  return application;
};

export const submitDemoRepresentativeApplication = (email: string) => {
  const application = state().applications.find((item) => item.email === email);
  if (!application)
    throw new DemoRepresentativeError("Salve a primeira etapa antes de enviar.", 409);
  if (!["draft", "documents_pending"].includes(application.status)) {
    throw new DemoRepresentativeError("Solicitação já enviada.", 409);
  }
  if (!application.steps["5"]?.termsAccepted) {
    throw new DemoRepresentativeError("Aceite os termos vigentes antes de enviar.", 422);
  }
  application.status = "submitted";
  application.currentStep = 6;
  application.updatedAt = now();
  return application;
};

export const reviewDemoRepresentativeApplication = (
  applicationId: string,
  decision: "start_review" | "request_documents" | "approve" | "reject" | "suspend",
  reason: string
) => {
  if (reason.trim().length < 3)
    throw new DemoRepresentativeError("Informe o motivo da decisão.", 422);
  const application = state().applications.find((item) => item.id === applicationId);
  if (!application) throw new DemoRepresentativeError("Solicitação não encontrada.", 404);
  const nextStatus: Record<typeof decision, RepresentativeApplicationStatus> = {
    start_review: "under_review",
    request_documents: "documents_pending",
    approve: "approved",
    reject: "rejected",
    suspend: "suspended"
  };
  application.status = nextStatus[decision];
  application.reason = reason.trim();
  application.updatedAt = now();
  if (
    decision === "approve" &&
    !state().representatives.some((item) => item.email === application.email)
  ) {
    state().representatives.push({
      id: randomUUID(),
      email: application.email,
      fullName: application.fullName,
      publicCode: code("REP"),
      referralCode: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      status: demoRules.kitActivationRequired ? "approved_waiting_kit" : "active",
      levelName: null,
      regionCode: "BR",
      activatedAt: demoRules.kitActivationRequired ? null : now()
    });
  }
  return application;
};

export const recordDemoRepresentativeSale = (
  email: string,
  items: Array<{ variantId: string; quantity: number }>,
  idempotencyKey: string
) => {
  const representative = state().representatives.find((item) => item.email === email);
  if (!representative || representative.status !== "active") {
    throw new DemoRepresentativeError("A representante precisa estar ativa.", 403);
  }
  const existing = state().sales.find(
    (item) => item.representativeId === representative.id && item.idempotencyKey === idempotencyKey
  );
  if (existing) return existing;
  if (items.length < 1 || items.length > 50 || new Set(items.map((item) => item.variantId)).size !== items.length) {
    throw new DemoRepresentativeError("Informe itens válidos e sem duplicidade.", 422);
  }
  let totalInCents = 0;
  const selected = items.map((item) => {
    const inventory = state().inventory.find(
      (entry) => entry.representativeId === representative.id && entry.variantId === item.variantId
    );
    if (!inventory || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > inventory.quantity) {
      throw new DemoRepresentativeError("Item indisponível no estoque demonstrativo.", 409);
    }
    totalInCents += inventory.priceInCents * item.quantity;
    return { inventory, quantity: item.quantity };
  });
  const sale = {
    id: randomUUID(),
    publicCode: code("VD"),
    representativeId: representative.id,
    totalInCents,
    status: "confirmed",
    soldAt: now(),
    idempotencyKey,
    items: items.map((item) => ({ ...item }))
  };
  selected.forEach(({ inventory, quantity }) => {
    inventory.quantity -= quantity;
  });
  state().sales.unshift(sale);
  return sale;
};

export const registerDemoCreativeEvent = (email: string, creativeId: string, type: string) => {
  const representative = state().representatives.find((item) => item.email === email);
  const creative = state().creatives.find(
    (item) => item.id === creativeId && item.status === "published"
  );
  if (!representative || !creative)
    throw new DemoRepresentativeError("Criativo indisponível.", 404);
  if (!["view", "download", "copy", "favorite", "unfavorite", "share"].includes(type)) {
    throw new DemoRepresentativeError("Evento inválido.", 400);
  }
  state().creativeEvents.push({ creativeId, representativeId: representative.id, type });
};

export const updateDemoRepresentativeProfile = (email: string, regionCode: string) => {
  const representative = state().representatives.find((item) => item.email === email);
  if (!representative) throw new DemoRepresentativeError("Representante não encontrada.", 404);
  if (!/^[A-Z]{2,8}$/u.test(regionCode)) {
    throw new DemoRepresentativeError("Informe uma região válida.", 422);
  }
  representative.regionCode = regionCode;
  return representative;
};

export const createDemoKitOrder = (email: string, kitId: string, idempotencyKey: string) => {
  const representative = state().representatives.find((item) => item.email === email);
  if (!representative || !["active", "approved_waiting_kit", "unqualified"].includes(representative.status)) {
    throw new DemoRepresentativeError("Compra de kit indisponível para este perfil.", 403);
  }
  const existing = state().kitOrders.find(
    (item) => item.representativeId === representative.id && item.id === idempotencyKey
  );
  if (existing) return existing;
  if (kitId !== "20000000-0000-4000-8000-000000000001") {
    throw new DemoRepresentativeError("Kit demonstrativo indisponível.", 404);
  }
  const order = {
    id: idempotencyKey,
    publicCode: code("KIT"),
    representativeId: representative.id,
    kitName: "Kit demonstrativo curti Z",
    status: "paid",
    totalInCents: 19990
  };
  state().kitOrders.unshift(order);
  return order;
};

export const cancelDemoRepresentativeSale = (email: string, saleId: string) => {
  const representative = state().representatives.find((item) => item.email === email);
  const sale = state().sales.find(
    (item) => item.id === saleId && item.representativeId === representative?.id
  );
  if (!sale || sale.status !== "confirmed") {
    throw new DemoRepresentativeError("Venda não pode ser cancelada.", 409);
  }
  sale.items.forEach((item) => {
    const inventory = state().inventory.find(
      (entry) =>
        entry.representativeId === representative?.id && entry.variantId === item.variantId
    );
    if (inventory) inventory.quantity += item.quantity;
  });
  sale.status = "cancelled";
  return sale;
};

export const markDemoRepresentativeNotification = (email: string, notificationId: string) => {
  const representative = state().representatives.find((item) => item.email === email);
  const notification = state().notifications.find(
    (item) => item.id === notificationId && item.representativeId === representative?.id
  );
  if (!notification) throw new DemoRepresentativeError("Notificação não encontrada.", 404);
  notification.readAt = now();
  return notification;
};

export const listDemoCreatives = (publishedOnly = false) =>
  state().creatives.filter((creative) => !publishedOnly || creative.status === "published");

export const createDemoCreative = (input: {
  title: string;
  campaign: string;
  type: DemoCreative["type"];
  platform: string;
  caption: string;
}) => {
  const creative: DemoCreative = {
    id: randomUUID(),
    ...input,
    status: "draft",
    publishedAt: "",
    demo: true
  };
  state().creatives.unshift(creative);
  return creative;
};

export const transitionDemoCreative = (
  creativeId: string,
  status: Extract<
    CreativeStatus,
    "pending_review" | "approved" | "published" | "rejected" | "archived"
  >
) => {
  const creative = state().creatives.find((item) => item.id === creativeId);
  if (!creative) throw new DemoRepresentativeError("Criativo não encontrado.", 404);
  const allowed: Record<CreativeStatus, readonly CreativeStatus[]> = {
    draft: ["pending_review"],
    pending_review: ["approved", "rejected"],
    approved: ["published", "archived"],
    scheduled: ["published", "archived"],
    published: ["archived"],
    expired: ["archived"],
    archived: [],
    rejected: []
  };
  if (!allowed[creative.status].includes(status)) {
    throw new DemoRepresentativeError("Transição de criativo não permitida.", 409);
  }
  creative.status = status;
  if (status === "published") creative.publishedAt = now();
  return creative;
};
