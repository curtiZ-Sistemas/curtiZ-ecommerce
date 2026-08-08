import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { authorizeLegalRequest, legalPermissions, type LegalPermission } from "@/lib/legal-api";

const sectionSchema = z.object({
  section_number: z.string().regex(/^\d+(?:\.\d+)*$/u),
  title: z.string().trim().min(2).max(180),
  content: z.string().max(30000),
  sort_order: z.number().int().min(0).max(1000)
});

const documentSchema = z.object({
  internal_name: z.string().trim().min(3).max(160),
  public_title: z.string().trim().min(3).max(180),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  summary: z.string().trim().max(1000),
  document_type: z.string().trim().min(2).max(80),
  language: z.string().trim().max(20).default("pt-BR"),
  audience: z.string().trim().max(80).default("public"),
  requires_acceptance: z.boolean().default(false),
  requires_new_acceptance: z.boolean().default(false),
  display_locations: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  change_summary: z.string().trim().max(2000).default(""),
  internal_notes: z.string().trim().max(5000).default(""),
  reference_ids: z.array(z.string().uuid()).max(30).default([])
});

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    document: documentSchema,
    sections: z.array(sectionSchema).min(1).max(80)
  }),
  z.object({
    kind: z.literal("reference"),
    name: z.string().trim().min(3).max(240),
    relatedArticle: z.string().trim().max(160).optional(),
    officialUrl: z.string().url().startsWith("https://"),
    notes: z.string().trim().max(1000)
  }),
  z.object({
    kind: z.literal("cookie"),
    namePattern: z.string().trim().min(2).max(160),
    categoryId: z.string().trim().min(2).max(60),
    provider: z.string().trim().min(2).max(120),
    purpose: z.string().trim().min(5).max(1000),
    durationDescription: z.string().trim().min(3).max(300),
    firstParty: z.boolean(),
    active: z.boolean()
  })
]);

const updateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    id: z.string().uuid(),
    document: documentSchema,
    sections: z.array(sectionSchema).min(1).max(80)
  }),
  z.object({
    kind: z.literal("transition"),
    id: z.string().uuid(),
    action: z.enum([
      "submit_review",
      "request_changes",
      "legally_reviewed",
      "approve",
      "reject",
      "publish",
      "schedule",
      "archive",
      "restore",
      "begin_revision"
    ]),
    reason: z.string().trim().min(3).max(1000),
    effectiveFrom: z.string().datetime().nullable().optional()
  }),
  z.object({
    kind: z.literal("restore_version"),
    versionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000)
  }),
  z.object({
    kind: z.literal("company"),
    legalName: z.string().trim().max(200),
    tradeName: z.string().trim().max(200),
    taxId: z.string().trim().max(30),
    address: z.string().trim().max(500),
    email: z.string().trim().email().or(z.literal("")),
    phone: z.string().trim().max(40),
    privacyChannel: z.string().trim().max(240),
    dataProtectionContact: z.string().trim().max(200),
    supportChannel: z.string().trim().max(240),
    completenessStatus: z.enum(["incomplete", "review", "complete"])
  }),
  z.object({
    kind: z.literal("cookie"),
    id: z.string().uuid(),
    categoryId: z.string().trim().min(2).max(60),
    provider: z.string().trim().min(2).max(120),
    purpose: z.string().trim().min(5).max(1000),
    durationDescription: z.string().trim().min(3).max(300),
    firstParty: z.boolean(),
    active: z.boolean()
  }),
  z.object({
    kind: z.literal("privacy_request"),
    id: z.string().uuid(),
    status: z.enum([
      "requested",
      "identity_verification",
      "in_progress",
      "answered",
      "rejected",
      "completed"
    ]),
    identityStatus: z.enum(["pending", "verified", "rejected"]),
    responseSummary: z.string().trim().max(3000),
    publicNote: z.string().trim().min(3).max(1000)
  })
]);

function message(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  if (text.includes("duplicate key")) return "Já existe um documento com esse identificador.";
  if (text.includes("company legal information is incomplete"))
    return "Preencha e marque os dados empresariais como completos antes de publicar.";
  if (text.includes("responsible, legal review"))
    return "Responsável, revisão jurídica e aprovação gerencial são obrigatórios.";
  if (text.includes("invalid legal transition"))
    return "A transição não é permitida no estado atual.";
  return "Não foi possível concluir a operação jurídica.";
}

export async function GET(request: NextRequest) {
  const auth = await authorizeLegalRequest(request, "legal_content.view");
  if (!auth) return unauthorizedAdminResponse();
  const permissionEntries = Promise.all(
    legalPermissions.map(async (permission) => {
      const result = await auth.supabase.rpc("has_legal_permission", { p_permission: permission });
      return [permission, !result.error && result.data === true] as const;
    })
  );
  const [
    documents,
    sections,
    versions,
    reviews,
    references,
    referenceLinks,
    company,
    categories,
    cookies,
    requests,
    events,
    acceptances,
    permissions
  ] = await Promise.all([
    auth.supabase.from("legal_documents").select("*").order("updated_at", { ascending: false }),
    auth.supabase.from("legal_document_sections").select("*").order("sort_order"),
    auth.supabase
      .from("legal_document_versions")
      .select("id,document_id,version,content_hash,snapshot,effective_from,effective_until,published_at")
      .order("version", { ascending: false }),
    auth.supabase
      .from("legal_document_reviews")
      .select("id,document_id,decision,reason,reviewer_id,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    auth.supabase.from("legal_references").select("*").order("name"),
    auth.supabase.from("legal_document_reference_links").select("document_id,reference_id"),
    auth.supabase.from("company_legal_information").select("*").eq("id", true).maybeSingle(),
    auth.supabase.from("cookie_categories").select("*").order("sort_order"),
    auth.supabase.from("cookie_definitions").select("*").order("name_pattern"),
    auth.supabase
      .from("data_requests")
      .select(
        "id,public_code,request_type,status,requested_at,requester_name,requester_email,identity_status,assigned_to,response_summary,due_at,updated_at"
      )
      .order("requested_at", { ascending: false })
      .limit(200),
    auth.supabase
      .from("privacy_request_events")
      .select("id,request_id,event_type,public_note,internal_note,actor_id,created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    auth.supabase
      .from("legal_acceptances")
      .select(
        "id,user_id,document_version_id,context,acceptance_type,accepted,accepted_at,revoked_at"
      )
      .order("accepted_at", { ascending: false })
      .limit(300),
    permissionEntries
  ]);
  const failed = [
    documents,
    sections,
    versions,
    reviews,
    references,
    referenceLinks,
    company,
    categories,
    cookies,
    requests,
    events,
    acceptances
  ].find((result) => result.error);
  if (failed?.error)
    return NextResponse.json(
      { message: "Não foi possível carregar o centro jurídico." },
      { status: 503, headers: privateNoStore }
    );
  return NextResponse.json(
    {
      documents: objectRows(documents.data),
      sections: objectRows(sections.data),
      versions: objectRows(versions.data),
      reviews: objectRows(reviews.data),
      references: objectRows(references.data),
      referenceLinks: objectRows(referenceLinks.data),
      company: objectRows([company.data])[0] ?? null,
      categories: objectRows(categories.data),
      cookies: objectRows(cookies.data),
      requests: objectRows(requests.data),
      events: objectRows(events.data),
      acceptances: objectRows(acceptances.data),
      capabilities: Object.fromEntries(permissions)
    },
    { headers: privateNoStore }
  );
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const body: unknown = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { message: "Revise os campos da minuta." },
      { status: 400, headers: privateNoStore }
    );
  const permission: LegalPermission =
    parsed.data.kind === "cookie"
      ? "cookie_settings.manage"
      : parsed.data.kind === "reference"
        ? "legal_content.edit"
        : "legal_content.create";
  const auth = await authorizeLegalRequest(request, permission);
  if (!auth) return unauthorizedAdminResponse();
  try {
    if (parsed.data.kind === "document") {
      const result = await auth.supabase.rpc("create_legal_document", {
        p_document: parsed.data.document,
        p_sections: parsed.data.sections
      });
      if (result.error) throw result.error;
      return NextResponse.json(
        {
          document: objectRows([result.data])[0] ?? null,
          message: "Minuta criada sem publicação automática."
        },
        { status: 201, headers: privateNoStore }
      );
    }
    if (parsed.data.kind === "reference") {
      const result = await auth.supabase
        .from("legal_references")
        .insert({
          name: parsed.data.name,
          related_article: parsed.data.relatedArticle || null,
          official_url: parsed.data.officialUrl,
          consulted_on: new Date().toISOString().slice(0, 10),
          notes: parsed.data.notes,
          created_by: auth.userId
        })
        .select("*")
        .single();
      if (result.error) throw result.error;
      return NextResponse.json(
        {
          reference: objectRows([result.data])[0] ?? null,
          message: "Referência oficial cadastrada."
        },
        { status: 201, headers: privateNoStore }
      );
    }
    const result = await auth.supabase
      .from("cookie_definitions")
      .insert({
        name_pattern: parsed.data.namePattern,
        category_id: parsed.data.categoryId,
        provider: parsed.data.provider,
        purpose: parsed.data.purpose,
        duration_description: parsed.data.durationDescription,
        first_party: parsed.data.firstParty,
        active: parsed.data.active,
        updated_by: auth.userId
      })
      .select("*")
      .single();
    if (result.error) throw result.error;
    return NextResponse.json(
      { cookie: objectRows([result.data])[0] ?? null, message: "Cookie incluído no inventário." },
      { status: 201, headers: privateNoStore }
    );
  } catch (error) {
    return NextResponse.json({ message: message(error) }, { status: 409, headers: privateNoStore });
  }
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const body: unknown = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { message: "Revise os dados enviados." },
      { status: 400, headers: privateNoStore }
    );
  const permission: LegalPermission =
    parsed.data.kind === "document"
      ? "legal_content.edit"
      : parsed.data.kind === "company"
        ? "legal_content.edit"
        : parsed.data.kind === "cookie"
          ? "cookie_settings.manage"
          : parsed.data.kind === "privacy_request"
            ? "privacy_request.manage"
            : parsed.data.kind === "restore_version"
              ? "legal_content.publish"
              : ["submit_review", "begin_revision"].includes(parsed.data.action)
                ? "legal_content.edit"
                : ["request_changes", "legally_reviewed", "reject"].includes(parsed.data.action)
                  ? "legal_content.review"
                  : parsed.data.action === "archive"
                    ? "legal_content.archive"
                    : "legal_content.publish";
  const auth = await authorizeLegalRequest(request, permission);
  if (!auth) return unauthorizedAdminResponse();
  try {
    if (parsed.data.kind === "document") {
      const result = await auth.supabase.rpc("save_legal_document", {
        p_document_id: parsed.data.id,
        p_document: parsed.data.document,
        p_sections: parsed.data.sections
      });
      if (result.error) throw result.error;
    } else if (parsed.data.kind === "transition") {
      const result = await auth.supabase.rpc("transition_legal_document", {
        p_document_id: parsed.data.id,
        p_action: parsed.data.action,
        p_reason: parsed.data.reason,
        p_effective_from: parsed.data.effectiveFrom ?? null
      });
      if (result.error) throw result.error;
    } else if (parsed.data.kind === "restore_version") {
      const result = await auth.supabase.rpc("restore_legal_document_version", {
        p_version_id: parsed.data.versionId,
        p_reason: parsed.data.reason
      });
      if (result.error) throw result.error;
    } else if (parsed.data.kind === "company") {
      const result = await auth.supabase
        .from("company_legal_information")
        .update({
          legal_name: parsed.data.legalName || null,
          trade_name: parsed.data.tradeName || null,
          tax_id: parsed.data.taxId || null,
          address: parsed.data.address || null,
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          privacy_channel: parsed.data.privacyChannel || null,
          data_protection_contact: parsed.data.dataProtectionContact || null,
          support_channel: parsed.data.supportChannel || null,
          completeness_status: parsed.data.completenessStatus,
          updated_by: auth.userId
        })
        .eq("id", true);
      if (result.error) throw result.error;
    } else if (parsed.data.kind === "cookie") {
      const result = await auth.supabase
        .from("cookie_definitions")
        .update({
          category_id: parsed.data.categoryId,
          provider: parsed.data.provider,
          purpose: parsed.data.purpose,
          duration_description: parsed.data.durationDescription,
          first_party: parsed.data.firstParty,
          active: parsed.data.active,
          last_verified_at: new Date().toISOString(),
          updated_by: auth.userId
        })
        .eq("id", parsed.data.id);
      if (result.error) throw result.error;
    } else {
      const result = await auth.supabase
        .from("data_requests")
        .update({
          status: parsed.data.status,
          identity_status: parsed.data.identityStatus,
          response_summary: parsed.data.responseSummary || null,
          assigned_to: auth.userId,
          completed_at: parsed.data.status === "completed" ? new Date().toISOString() : null
        })
        .eq("id", parsed.data.id);
      if (result.error) throw result.error;
      const event = await auth.supabase.from("privacy_request_events").insert({
        request_id: parsed.data.id,
        event_type: parsed.data.status,
        public_note: parsed.data.publicNote,
        actor_id: auth.userId
      });
      if (event.error) throw event.error;
    }
    return NextResponse.json(
      { message: "Alteração registrada com auditoria." },
      { headers: privateNoStore }
    );
  } catch (error) {
    return NextResponse.json({ message: message(error) }, { status: 409, headers: privateNoStore });
  }
}
