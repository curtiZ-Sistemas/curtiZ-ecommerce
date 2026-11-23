import { readJsonResponse } from "@curtiz/security";
import { logServerEvent } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "../../../../lib/admin-api";
import { postgresUuidSchema } from "../../../../lib/postgres-uuid";

export const dynamic = "force-dynamic";

const destinationType = z.enum(["category", "collection", "page", "internal_url"]);
const saveSchema = z.object({
  action: z.literal("save"),
  id: postgresUuidSchema.optional(),
  label: z.string().trim().min(1).max(60),
  placement: z.enum(["main", "utility"]),
  destinationType,
  destinationValue: z.string().trim().min(1).max(500),
  visible: z.boolean()
});
const toggleSchema = z.object({
  action: z.literal("toggle"),
  id: postgresUuidSchema,
  visible: z.boolean()
});
const reorderSchema = z.object({
  action: z.literal("reorder"),
  ids: z.array(postgresUuidSchema).max(100)
});
const deleteSchema = z.object({ action: z.literal("delete"), id: postgresUuidSchema });
const mutationSchema = z.discriminatedUnion("action", [
  saveSchema,
  toggleSchema,
  reorderSchema,
  deleteSchema
]);

const validPages = new Set(["/", "/produtos", "/ajuda", "/rastrear-pedido", "/favoritos"]);
const internalPath = (value: string) =>
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !value.includes("\\") &&
  ![...value].some((character) => character.charCodeAt(0) < 32);

async function authorized(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return null;
  const permission = await auth.supabase.rpc("has_permission", {
    permission_code: "catalog.taxonomy.manage"
  });
  if (permission.error) return { error: "permission" as const };
  if (permission.data !== true) return { error: "forbidden" as const };
  return { ...auth, error: null };
}

const authError = (error: "permission" | "forbidden") => NextResponse.json(
  {
    message: error === "forbidden"
      ? "Sua permissão não permite gerenciar a navegação."
      : "Não foi possível confirmar sua permissão."
  },
  { status: error === "forbidden" ? 403 : 503, headers: privateNoStore }
);

type DbError = { code?: string | null; message?: string; details?: string | null };

// Traduz o erro do banco em motivo específico; antes tudo virava "Não foi possível salvar".
function mutationFailure(action: string, fallback: string, error: DbError | null) {
  if (error) {
    logServerEvent("error", "panel_store_navigation_mutation_failed", {
      action,
      code: error.code,
      message: error.message?.slice(0, 180),
      details: error.details?.slice(0, 180)
    });
  }
  const code = error?.code ?? "";
  if (code === "42501") {
    return NextResponse.json(
      { message: "O banco recusou a gravação do menu (permissão de escrita ausente na tabela de navegação). Avise o suporte técnico." },
      { status: 403, headers: privateNoStore }
    );
  }
  if (code === "23505") {
    return NextResponse.json({ message: "Já existe um item de navegação com esses dados." }, { status: 409, headers: privateNoStore });
  }
  if (code === "23503") {
    return NextResponse.json({ message: "Não foi possível vincular o item ao seu perfil de administrador." }, { status: 409, headers: privateNoStore });
  }
  if (code === "23514" || code === "22P02") {
    return NextResponse.json({ message: "Algum valor não é aceito pelo menu. Revise nome e destino." }, { status: 400, headers: privateNoStore });
  }
  return NextResponse.json({ message: fallback }, { status: 409, headers: privateNoStore });
}

const fieldMessages: Record<string, string> = {
  label: "Informe o nome do item (até 60 caracteres).",
  destinationValue: "Escolha ou informe o destino do item.",
  placement: "Escolha onde o item aparece.",
  destinationType: "Escolha o tipo de destino."
};

export async function GET(request: NextRequest) {
  const auth = await authorized(request);
  if (!auth) return unauthorizedAdminResponse(request);
  if (auth.error) return authError(auth.error);
  const [items, categories, collections] = await Promise.all([
    auth.supabase
      .from("store_navigation_items")
      .select("id,label,placement,destination_type,destination_value,visible,sort_order")
      .order("placement")
      .order("sort_order")
      .order("created_at")
      .limit(100),
    auth.supabase.from("categories").select("id,name,slug,active").order("name").limit(500),
    auth.supabase.from("collections").select("id,name,slug,active").order("name").limit(500)
  ]);
  if (items.error || categories.error || collections.error) {
    for (const [table, error] of [
      ["store_navigation_items", items.error],
      ["categories", categories.error],
      ["collections", collections.error]
    ] as const) {
      if (error) {
        logServerEvent("error", "panel_store_navigation_api_query_failed", {
          table,
          code: error.code,
          message: error.message.slice(0, 180),
          details: error.details?.slice(0, 180)
        });
      }
    }
    return NextResponse.json(
      { message: "Não foi possível carregar a navegação da loja." },
      { status: 503, headers: privateNoStore }
    );
  }
  return NextResponse.json(
    { items: items.data ?? [], categories: categories.data ?? [], collections: collections.data ?? [] },
    { headers: privateNoStore }
  );
}

export async function PATCH(request: NextRequest) {
  if (!safePanelOrigin(request)) {
    return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: privateNoStore });
  }
  const auth = await authorized(request);
  if (!auth) return unauthorizedAdminResponse(request);
  if (auth.error) return authError(auth.error);
  const boundedBody = await readJsonResponse(request, 32768);
  if (boundedBody instanceof Response) return boundedBody;
  const parsed = mutationSchema.safeParse(boundedBody);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (fieldMessages[key] && !errors[key]) errors[key] = fieldMessages[key];
    }
    return NextResponse.json(
      { message: "Revise os campos destacados.", errors },
      { status: 400, headers: privateNoStore }
    );
  }

  if (parsed.data.action === "toggle") {
    const result = await auth.supabase
      .from("store_navigation_items")
      .update({ visible: parsed.data.visible, updated_by: auth.userId, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return mutationFailure("toggle", "Não foi possível alterar a visibilidade.", result.error);
    }
    return NextResponse.json({ message: parsed.data.visible ? "Item exibido na loja." : "Item ocultado da loja." }, { headers: privateNoStore });
  }

  if (parsed.data.action === "reorder") {
    const result = await auth.supabase.rpc("admin_reorder_store_navigation", { p_item_ids: parsed.data.ids });
    if (result.error) {
      return mutationFailure("reorder", "Não foi possível alterar a ordem.", result.error);
    }
    return NextResponse.json({ message: "Ordem da navegação atualizada." }, { headers: privateNoStore });
  }

  if (parsed.data.action === "delete") {
    const result = await auth.supabase
      .from("store_navigation_items")
      .delete()
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return mutationFailure("delete", "Não foi possível excluir o item.", result.error);
    }
    return NextResponse.json({ message: "Item removido da navegação." }, { headers: privateNoStore });
  }

  const destination = parsed.data.destinationValue;
  if (parsed.data.destinationType === "page" && !validPages.has(destination)) {
    return NextResponse.json({ message: "Escolha uma página interna válida.", errors: { destinationValue: "Escolha uma página interna válida." } }, { status: 400, headers: privateNoStore });
  }
  if (parsed.data.destinationType === "internal_url" && !internalPath(destination)) {
    return NextResponse.json({ message: "Informe somente uma URL interna iniciada por /.", errors: { destinationValue: "Informe somente uma URL interna iniciada por /." } }, { status: 400, headers: privateNoStore });
  }
  if (parsed.data.destinationType === "category" || parsed.data.destinationType === "collection") {
    const table = parsed.data.destinationType === "category" ? "categories" : "collections";
    const target = await auth.supabase.from(table).select("id").eq("slug", destination).maybeSingle();
    if (target.error || !target.data) {
      return NextResponse.json({ message: "O destino selecionado não existe mais.", errors: { destinationValue: "O destino selecionado não existe mais. Atualize a lista e escolha outro." } }, { status: 400, headers: privateNoStore });
    }
  }

  const values = {
    label: parsed.data.label,
    placement: parsed.data.placement,
    destination_type: parsed.data.destinationType,
    destination_value: destination,
    visible: parsed.data.visible,
    updated_by: auth.userId,
    updated_at: new Date().toISOString()
  };
  const result = parsed.data.id
    ? await auth.supabase.from("store_navigation_items").update(values).eq("id", parsed.data.id).select("id").maybeSingle()
    : await auth.supabase.from("store_navigation_items").insert({ ...values, created_by: auth.userId }).select("id").single();
  if (result.error || !result.data) {
    return mutationFailure("save", "Não foi possível salvar o item.", result.error);
  }
  return NextResponse.json({ message: parsed.data.id ? "Item atualizado." : "Item adicionado ao menu." }, { headers: privateNoStore });
}
