import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import {
  authorizeSupportContentRequest,
  supportContentPermissions,
  type SupportContentPermission
} from "@/lib/support-content-api";

const contentSchema = z.object({
  category_id: z.string().uuid(),
  content_type: z.enum([
    "faq",
    "article",
    "tutorial",
    "step_by_step",
    "notice",
    "video",
    "document",
    "quick_reply",
    "contextual"
  ]),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  title: z.string().trim().min(3).max(180),
  summary: z.string().trim().max(1000),
  body: z.string().trim().max(30000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30),
  synonyms: z.array(z.string().trim().min(1).max(80)).max(30),
  audiences: z
    .array(
      z.enum([
        "visitor",
        "customer",
        "representative",
        "operational",
        "admin",
        "manager",
        "technical"
      ])
    )
    .min(1),
  priority: z.number().int().min(0).max(1000),
  media: z
    .array(
      z.object({
        type: z.enum(["video", "image", "document"]),
        url: z.string().url().startsWith("https://"),
        label: z.string().trim().max(120)
      })
    )
    .max(10),
  attachments: z
    .array(z.object({ label: z.string().trim().max(120), path: z.string().trim().max(500) }))
    .max(20),
  related_action: z
    .object({
      label: z.string().trim().min(1).max(100),
      href: z.string().trim().startsWith("/").max(300)
    })
    .nullable(),
  related_ids: z.array(z.string().uuid()).max(20)
});

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("content"), payload: contentSchema }),
  z.object({
    kind: z.literal("category"),
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    description: z.string().trim().max(500),
    sortOrder: z.number().int().min(0).max(1000)
  }),
  z.object({
    kind: z.literal("quick_reply"),
    title: z.string().trim().min(3).max(120),
    shortcut: z
      .string()
      .trim()
      .regex(/^\/[a-z0-9-]{2,40}$/u),
    content: z.string().trim().min(3).max(4000),
    categoryId: z.string().uuid().nullable()
  })
]);

const updateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("content"),
    id: z.string().uuid(),
    payload: contentSchema,
    changeSummary: z.string().trim().min(3).max(1000)
  }),
  z.object({
    kind: z.literal("transition"),
    id: z.string().uuid(),
    action: z.enum([
      "submit_review",
      "approve",
      "reject",
      "publish",
      "schedule",
      "unpublish",
      "mark_outdated",
      "archive",
      "restore",
      "begin_revision"
    ]),
    reason: z.string().trim().min(3).max(1000),
    scheduledAt: z.string().datetime().nullable().optional()
  }),
  z.object({
    kind: z.literal("restore_version"),
    versionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000)
  }),
  z.object({
    kind: z.literal("category"),
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500),
    sortOrder: z.number().int().min(0).max(1000),
    active: z.boolean(),
    publicVisible: z.boolean()
  }),
  z.object({
    kind: z.literal("quick_reply"),
    id: z.string().uuid(),
    title: z.string().trim().min(3).max(120),
    content: z.string().trim().min(3).max(4000),
    active: z.boolean()
  })
]);

function permissionForAction(
  action: z.infer<typeof updateSchema>["kind"],
  transition?: string
): SupportContentPermission {
  if (action === "category" || action === "quick_reply") return "support_settings.manage";
  if (action === "restore_version") return "support_content.publish";
  if (action === "transition") {
    if (transition === "submit_review") return "support_content.edit";
    if (transition === "approve" || transition === "reject") return "support_content.review";
    return "support_content.publish";
  }
  return "support_content.edit";
}

export async function GET(request: NextRequest) {
  const auth = await authorizeSupportContentRequest(request, "support_content.view");
  if (!auth) return unauthorizedAdminResponse();
  const [
    contents,
    categories,
    versions,
    relations,
    searches,
    feedback,
    tickets,
    replies,
    audit,
    capabilityRows
  ] = await Promise.all([
    auth.supabase
      .from("help_contents")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500),
    auth.supabase.from("support_categories").select("*").order("sort_order").limit(100),
    auth.supabase
      .from("help_content_versions")
      .select("id,content_id,version,status,change_summary,created_at,created_by")
      .order("created_at", { ascending: false })
      .limit(500),
    auth.supabase.from("help_content_relations").select("*").order("sort_order").limit(1000),
    auth.supabase
      .from("help_search_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    auth.supabase
      .from("help_content_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    auth.supabase
      .from("support_conversations")
      .select("id,status,category_id,created_at,first_response_at,resolved_at")
      .order("created_at", { ascending: false })
      .limit(500),
    auth.supabase.from("support_saved_replies").select("*").order("title").limit(200),
    auth.supabase
      .from("audit_logs")
      .select("id,action,entity_id,actor_role,reason,created_at")
      .eq("entity_type", "help_content")
      .order("created_at", { ascending: false })
      .limit(200),
    Promise.all(
      supportContentPermissions.map(async (permission) => ({
        permission,
        result: await auth.supabase.rpc("has_support_permission", { p_permission: permission })
      }))
    )
  ]);
  const failed = [contents, categories, versions, relations, tickets, replies].find(
    (result) => result.error
  );
  if (failed?.error)
    return NextResponse.json(
      { message: "Não foi possível carregar a Central de Ajuda." },
      { status: 503, headers: privateNoStore }
    );
  return NextResponse.json(
    {
      contents: objectRows(contents.data),
      categories: objectRows(categories.data),
      versions: objectRows(versions.data),
      relations: objectRows(relations.data),
      searches: searches.error ? [] : objectRows(searches.data),
      feedback: feedback.error ? [] : objectRows(feedback.data),
      tickets: objectRows(tickets.data),
      replies: objectRows(replies.data),
      audit: audit.error ? [] : objectRows(audit.data),
      userId: auth.userId,
      capabilities: Object.fromEntries(
        capabilityRows.map(({ permission, result }) => [
          permission,
          !result.error && result.data === true
        ])
      )
    },
    { headers: privateNoStore }
  );
}

export async function POST(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ message: "Revise os campos informados." }, { status: 400 });
  const permission: SupportContentPermission =
    parsed.data.kind === "content" ? "support_content.create" : "support_settings.manage";
  const auth = await authorizeSupportContentRequest(request, permission);
  if (!auth) return unauthorizedAdminResponse();
  let result: unknown;
  if (parsed.data.kind === "content")
    result = await auth.supabase.rpc("create_help_content", { p_payload: parsed.data.payload });
  else if (parsed.data.kind === "category")
    result = await auth.supabase
      .from("support_categories")
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        sort_order: parsed.data.sortOrder,
        created_by: auth.userId,
        updated_by: auth.userId
      })
      .select()
      .single();
  else
    result = await auth.supabase
      .from("support_saved_replies")
      .insert({
        title: parsed.data.title,
        shortcut: parsed.data.shortcut,
        content: parsed.data.content,
        category_id: parsed.data.categoryId,
        allowed_roles: ["operational", "admin", "manager"],
        created_by: auth.userId
      })
      .select()
      .single();
  const resultRecord =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  return NextResponse.json(
    resultRecord.error
      ? { message: "Não foi possível criar o registro." }
      : { ok: true, data: resultRecord.data },
    { status: resultRecord.error ? 409 : 201, headers: privateNoStore }
  );
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ message: "Revise os campos informados." }, { status: 400 });
  const auth = await authorizeSupportContentRequest(
    request,
    permissionForAction(
      parsed.data.kind,
      parsed.data.kind === "transition" ? parsed.data.action : undefined
    )
  );
  if (!auth) return unauthorizedAdminResponse();
  let result: unknown;
  if (parsed.data.kind === "content")
    result = await auth.supabase.rpc("save_help_content", {
      p_id: parsed.data.id,
      p_payload: parsed.data.payload,
      p_change_summary: parsed.data.changeSummary
    });
  else if (parsed.data.kind === "transition")
    result = await auth.supabase.rpc("transition_help_content", {
      p_id: parsed.data.id,
      p_action: parsed.data.action,
      p_reason: parsed.data.reason,
      p_scheduled_at: parsed.data.scheduledAt ?? null
    });
  else if (parsed.data.kind === "restore_version")
    result = await auth.supabase.rpc("restore_help_content_version", {
      p_version_id: parsed.data.versionId,
      p_reason: parsed.data.reason
    });
  else if (parsed.data.kind === "category")
    result = await auth.supabase
      .from("support_categories")
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        sort_order: parsed.data.sortOrder,
        active: parsed.data.active,
        public_visible: parsed.data.publicVisible,
        updated_by: auth.userId
      })
      .eq("id", parsed.data.id)
      .select()
      .single();
  else
    result = await auth.supabase
      .from("support_saved_replies")
      .update({
        title: parsed.data.title,
        content: parsed.data.content,
        active: parsed.data.active,
        updated_by: auth.userId
      })
      .eq("id", parsed.data.id)
      .select()
      .single();
  const resultRecord =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  return NextResponse.json(
    resultRecord.error
      ? { message: "Não foi possível concluir a operação." }
      : { ok: true, data: resultRecord.data },
    { status: resultRecord.error ? 409 : 200, headers: privateNoStore }
  );
}

export async function DELETE(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json({ message: "Origem não autorizada." }, { status: 403 });
  const parsed = z
    .object({ id: z.string().uuid(), confirmation: z.literal("EXCLUIR") })
    .safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ message: "Confirmação inválida." }, { status: 400 });
  const auth = await authorizeSupportContentRequest(request, "support_content.edit");
  if (!auth) return unauthorizedAdminResponse();
  const result = await auth.supabase.rpc("delete_help_content_draft", {
    p_id: parsed.data.id,
    p_confirmation: parsed.data.confirmation
  });
  return NextResponse.json(
    result.error
      ? { message: "Somente rascunhos nunca versionados podem ser excluídos." }
      : { ok: true },
    { status: result.error ? 409 : 200, headers: privateNoStore }
  );
}
