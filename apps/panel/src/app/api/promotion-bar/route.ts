import { type NextRequest, NextResponse } from "next/server";
import {
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse,
  authorizeAdminRequest
} from "@/lib/admin-api";
import {
  promotionBarMutationSchema,
  promotionBarReorderSchema
} from "@/lib/promotion-bar";

export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request, ["admin", "manager"]);
  if (!authorization) return null;
  const permission = await authorization.supabase.rpc("has_permission", {
    permission_code: "promotion_bar.manage"
  });
  return !permission.error && permission.data === true ? authorization : null;
}

function invalidOrigin(request: NextRequest) {
  if (safePanelOrigin(request)) return null;
  return NextResponse.json(
    { message: "Origem não permitida." },
    { status: 403, headers: privateNoStore }
  );
}

function databaseFailure(error: { message?: string } | null) {
  const limitReached = error?.message?.includes("active message limit exceeded");
  return NextResponse.json(
    {
      message: limitReached
        ? "A barra promocional aceita no máximo três mensagens ativas."
        : "Não foi possível salvar a barra promocional."
    },
    { status: 409, headers: privateNoStore }
  );
}

export async function GET(request: NextRequest) {
  const authorization = await authorize(request);
  if (!authorization) return unauthorizedAdminResponse();

  const result = await authorization.supabase
    .from("store_campaign_messages")
    .select(
      "id,message_text,cta_label,link_path,active,sort_order,starts_at,ends_at,updated_at"
    )
    .eq("placement", "top_bar")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (result.error) {
    return NextResponse.json(
      { message: "Não foi possível carregar a barra promocional." },
      { status: 503, headers: privateNoStore }
    );
  }

  return NextResponse.json(
    { messages: result.data ?? [], maximumActive: 3, canManage: true },
    { headers: privateNoStore }
  );
}

export async function POST(request: NextRequest) {
  const originResponse = invalidOrigin(request);
  if (originResponse) return originResponse;
  const authorization = await authorize(request);
  if (!authorization) return unauthorizedAdminResponse();

  const parsed = promotionBarMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.id) {
    return NextResponse.json(
      { message: "Revise os dados da mensagem promocional." },
      { status: 400, headers: privateNoStore }
    );
  }

  const value = parsed.data;
  const result = await authorization.supabase
    .from("store_campaign_messages")
    .insert({
      placement: "top_bar",
      message_text: value.text,
      cta_label: value.cta,
      link_path: value.href,
      active: value.active,
      sort_order: value.sortOrder,
      starts_at: value.startsAt,
      ends_at: value.endsAt,
      created_by: authorization.userId,
      updated_by: authorization.userId
    })
    .select("id")
    .single();

  if (result.error) return databaseFailure(result.error);
  const created: unknown = result.data;
  const createdId =
    created &&
    typeof created === "object" &&
    "id" in created &&
    typeof created.id === "string"
      ? created.id
      : null;
  if (!createdId) return databaseFailure(null);
  return NextResponse.json(
    { id: createdId, message: "Mensagem criada." },
    { status: 201, headers: privateNoStore }
  );
}

export async function PATCH(request: NextRequest) {
  const originResponse = invalidOrigin(request);
  if (originResponse) return originResponse;
  const authorization = await authorize(request);
  if (!authorization) return unauthorizedAdminResponse();
  const body: unknown = await request.json().catch(() => null);

  const reorder = promotionBarReorderSchema.safeParse(body);
  if (reorder.success) {
    const result = await authorization.supabase.rpc("reorder_store_campaign_messages", {
      p_message_ids: reorder.data.ids
    });
    if (result.error) return databaseFailure(result.error);
    return NextResponse.json({ message: "Ordem atualizada." }, { headers: privateNoStore });
  }

  const parsed = promotionBarMutationSchema.safeParse(body);
  if (!parsed.success || !parsed.data.id) {
    return NextResponse.json(
      { message: "Revise os dados da mensagem promocional." },
      { status: 400, headers: privateNoStore }
    );
  }

  const value = parsed.data;
  const result = await authorization.supabase
    .from("store_campaign_messages")
    .update({
      message_text: value.text,
      cta_label: value.cta,
      link_path: value.href,
      active: value.active,
      sort_order: value.sortOrder,
      starts_at: value.startsAt,
      ends_at: value.endsAt,
      updated_by: authorization.userId
    })
    .eq("id", value.id)
    .eq("placement", "top_bar")
    .select("id")
    .maybeSingle();

  if (result.error || !result.data) return databaseFailure(result.error);
  return NextResponse.json({ message: "Mensagem atualizada." }, { headers: privateNoStore });
}
