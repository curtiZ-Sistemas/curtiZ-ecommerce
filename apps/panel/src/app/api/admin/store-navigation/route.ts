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

export async function GET(request: NextRequest) {
  const auth = await authorized(request);
  if (!auth) return unauthorizedAdminResponse();
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
        console.error("[panel-store-navigation-api] query failed", {
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
  if (!auth) return unauthorizedAdminResponse();
  if (auth.error) return authError(auth.error);
  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revise os dados informados." }, { status: 400, headers: privateNoStore });
  }

  if (parsed.data.action === "toggle") {
    const result = await auth.supabase
      .from("store_navigation_items")
      .update({ visible: parsed.data.visible, updated_by: auth.userId, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return NextResponse.json({ message: "Não foi possível alterar a visibilidade." }, { status: 409, headers: privateNoStore });
    }
    return NextResponse.json({ message: parsed.data.visible ? "Item exibido na loja." : "Item ocultado da loja." }, { headers: privateNoStore });
  }

  if (parsed.data.action === "reorder") {
    const result = await auth.supabase.rpc("admin_reorder_store_navigation", { p_item_ids: parsed.data.ids });
    if (result.error) {
      return NextResponse.json({ message: "Não foi possível alterar a ordem." }, { status: 409, headers: privateNoStore });
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
      return NextResponse.json({ message: "Não foi possível excluir o item." }, { status: 409, headers: privateNoStore });
    }
    return NextResponse.json({ message: "Item removido da navegação." }, { headers: privateNoStore });
  }

  const destination = parsed.data.destinationValue;
  if (parsed.data.destinationType === "page" && !validPages.has(destination)) {
    return NextResponse.json({ message: "Escolha uma página interna válida." }, { status: 400, headers: privateNoStore });
  }
  if (parsed.data.destinationType === "internal_url" && !internalPath(destination)) {
    return NextResponse.json({ message: "Informe somente uma URL interna iniciada por /." }, { status: 400, headers: privateNoStore });
  }
  if (parsed.data.destinationType === "category" || parsed.data.destinationType === "collection") {
    const table = parsed.data.destinationType === "category" ? "categories" : "collections";
    const target = await auth.supabase.from(table).select("id").eq("slug", destination).maybeSingle();
    if (target.error || !target.data) {
      return NextResponse.json({ message: "O destino selecionado não existe mais." }, { status: 400, headers: privateNoStore });
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
    return NextResponse.json({ message: "Não foi possível salvar o item." }, { status: 409, headers: privateNoStore });
  }
  return NextResponse.json({ message: parsed.data.id ? "Item atualizado." : "Item adicionado ao menu." }, { headers: privateNoStore });
}
