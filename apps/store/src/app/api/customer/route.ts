import { z } from "zod";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { isUnknownRecord, readQueryResult, readString } from "@/lib/unknown-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(""), z.null()]).optional();
const base = z.object({ action: z.string().min(1).max(50) });
const schemas = {
  profile_update: base.extend({
    action: z.literal("profile_update"),
    fullName: z.string().trim().min(3).max(120),
    phone: z.string().trim().max(24),
    birthDate: z
      .union([z.iso.date(), z.literal("")])
      .refine((value) => !value || value <= new Date().toISOString().slice(0, 10))
  }),
  address_save: base.extend({
    action: z.literal("address_save"),
    id: optionalUuid,
    label: z.string().trim().min(2).max(40),
    recipientName: z.string().trim().min(3).max(120),
    postalCode: z.string().regex(/^\d{5}-?\d{3}$/u),
    street: z.string().trim().min(2).max(160),
    number: z.string().trim().min(1).max(20),
    complement: z.string().trim().max(100),
    district: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/u),
    isDefault: z.boolean()
  }),
  address_delete: base.extend({
    action: z.literal("address_delete"),
    id: uuid
  }),
  favorite_save: base.extend({
    action: z.literal("favorite_save"),
    productId: uuid
  }),
  favorite_remove: base.extend({
    action: z.literal("favorite_remove"),
    productId: uuid
  }),
  review_save: base.extend({
    action: z.literal("review_save"),
    reviewId: optionalUuid,
    orderItemId: uuid,
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(100),
    content: z.string().trim().max(2000)
  }),
  notification_read: base.extend({
    action: z.literal("notification_read"),
    id: uuid.optional()
  }),
  order_cancel: base.extend({
    action: z.literal("order_cancel"),
    orderId: uuid
  }),
  return_request: base.extend({
    action: z.literal("return_request"),
    orderItemId: uuid,
    quantity: z.number().int().min(1).max(20),
    reason: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(2000),
    resolution: z.enum(["exchange", "refund", "store_credit"])
  }),
  data_request: base.extend({
    action: z.literal("data_request"),
    requestType: z.enum(["export", "correction", "anonymization", "deletion"])
  })
} as const;

type ActionName = keyof typeof schemas;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });

const friendlyError = (error: unknown) => {
  if (!isUnknownRecord(error)) return "Não foi possível concluir a ação.";
  const code = readString(error, "code");
  const message = readString(error, "message");
  if (code === "P0002" || message.includes("_not_found")) {
    return "O item não foi encontrado ou não pertence à sua conta.";
  }
  if (code === "23514" || message.includes("_not_allowed")) {
    return "Esta ação não está disponível para o estado atual.";
  }
  if (code === "23505") return "Esta informação já foi cadastrada.";
  return "Não foi possível concluir a ação. Tente novamente.";
};

const stringValue = (value: unknown) => (typeof value === "string" ? value : "");

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return json({ message: "Origem não permitida." }, 403);

  const body: unknown = await request.json().catch(() => null);
  if (!isUnknownRecord(body) || typeof body.action !== "string") {
    return json({ message: "Dados inválidos." }, 400);
  }
  const action = body.action as ActionName;
  const schema = schemas[action];
  if (!schema) return json({ message: "Ação inválida." }, 400);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json({ message: "Revise os campos informados." }, 400);

  const cookieStore = await cookies();
  const demo = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);
  if (demo) {
    if (!demo.roles.includes("customer")) return json({ message: "Faça login para continuar." }, 401);
    return json({
      ok: true,
      simulated: true,
      message: "Alteração salva para esta sessão."
    });
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const user = userResult.data.user;
  if (!supabase || !user) return json({ message: "Faça login para continuar." }, 401);

  let response: unknown;
  const data = parsed.data as Record<string, unknown>;

  switch (action) {
    case "profile_update":
      response = await supabase
        .from("profiles")
        .update({
          full_name: data.fullName,
          phone: data.phone || null,
          birth_date: data.birthDate || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", user.id);
      break;
    case "address_save":
      response = await supabase.rpc("save_customer_address", {
        p_id: data.id || null,
        p_label: data.label,
        p_recipient_name: data.recipientName,
        p_postal_code: data.postalCode,
        p_street: data.street,
        p_number: data.number,
        p_complement: data.complement,
        p_district: data.district,
        p_city: data.city,
        p_state: data.state,
        p_is_default: data.isDefault
      });
      break;
    case "address_delete": {
      const addressId = stringValue(data.id);
      const defaultResponse = await supabase
        .from("addresses")
        .select("is_default")
        .eq("id", addressId)
        .eq("user_id", user.id)
        .maybeSingle();
      const address = readQueryResult(defaultResponse).data;
      if (isUnknownRecord(address) && address.is_default === true) {
        return json(
          { message: "Defina outro endereço principal antes de excluir este." },
          409
        );
      }
      response = await supabase
        .from("addresses")
        .delete()
        .eq("id", addressId)
        .eq("user_id", user.id);
      break;
    }
    case "favorite_save": {
      const productId = stringValue(data.productId);
      const productResponse = await supabase
        .from("products")
        .select("id")
        .eq("id", productId)
        .eq("status", "active")
        .maybeSingle();
      if (!readQueryResult(productResponse).data) {
        return json({ message: "Produto indisponível." }, 409);
      }
      response = await supabase
        .from("favorites")
        .upsert({ customer_id: user.id, product_id: productId });
      break;
    }
    case "favorite_remove":
      response = await supabase
        .from("favorites")
        .delete()
        .eq("customer_id", user.id)
        .eq("product_id", stringValue(data.productId));
      break;
    case "review_save": {
      const itemResponse = await supabase
        .from("order_items")
        .select("id,product_id,variant_id,orders!inner(customer_id,status)")
        .eq("id", stringValue(data.orderItemId))
        .eq("orders.customer_id", user.id)
        .eq("orders.status", "delivered")
        .maybeSingle();
      const item = readQueryResult(itemResponse).data;
      if (!isUnknownRecord(item)) {
        return json({ message: "Somente compras entregues podem ser avaliadas." }, 409);
      }
      const payload = {
        rating: data.rating,
        title: data.title || null,
        content: data.content || "",
        status: "pending",
        edited_at: data.reviewId ? new Date().toISOString() : null
      };
      response = data.reviewId
        ? await supabase
            .from("reviews")
            .update(payload)
            .eq("id", stringValue(data.reviewId))
            .eq("customer_id", user.id)
            .in("status", ["pending", "rejected"])
            .select("id")
            .single()
        : await supabase.from("reviews").insert({
            ...payload,
            customer_id: user.id,
            order_item_id: data.orderItemId,
            product_id: readString(item, "product_id"),
            variant_id: readString(item, "variant_id"),
            verified_purchase: true
          }).select("id").single();
      break;
    }
    case "notification_read":
      response = data.id
        ? await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("id", stringValue(data.id))
            .eq("user_id", user.id)
        : await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .is("read_at", null);
      break;
    case "order_cancel":
      response = await supabase.rpc("request_customer_order_cancellation", {
        p_order_id: data.orderId
      });
      break;
    case "return_request":
      response = await supabase.rpc("request_customer_return", {
        p_order_item_id: data.orderItemId,
        p_quantity: data.quantity,
        p_reason: data.reason,
        p_description: data.description,
        p_resolution: data.resolution
      });
      break;
    case "data_request":
      response = await supabase.from("data_requests").insert({
        customer_id: user.id,
        request_type: data.requestType
      });
      break;
  }

  const result = readQueryResult(response);
  if (result.error) return json({ message: friendlyError(result.error) }, 409);
  revalidatePath("/minha-conta", "layout");
  return json({ ok: true, data: result.data });
}
