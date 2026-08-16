import "server-only";

import {
  DEMO_SESSION_COOKIE,
  demoDestination,
  verifyDemoSession
} from "@curtiz/security";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  emptyCustomerAccount,
  type CustomerAccountSnapshot,
  type CustomerOrder,
  type CustomerOrderItem
} from "@/lib/customer-account-types";
import {
  isUnknownRecord,
  readNumber,
  readQueryResult,
  readRows,
  readString,
  type UnknownRecord
} from "@/lib/unknown-data";

const cents = (value: unknown) => {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const record = (value: unknown): UnknownRecord =>
  isUnknownRecord(value) ? value : {};

const publicImage = (path: string) => {
  if (!path) return "";
  if (/^https?:\/\//u.test(path)) return path;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url
    ? `${url}/storage/v1/object/public/catalog-public/${path.replace(/^catalog-public\//u, "")}`
    : "";
};

const relation = (value: unknown) => {
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
};

const mapAddress = (row: UnknownRecord) => ({
  id: readString(row, "id"),
  label: readString(row, "label"),
  recipientName: readString(row, "recipient_name"),
  postalCode: readString(row, "postal_code"),
  street: readString(row, "street"),
  number: readString(row, "number"),
  complement: readString(row, "complement"),
  district: readString(row, "district"),
  city: readString(row, "city"),
  state: readString(row, "state"),
  isDefault: row.is_default === true
});

const mapOrderItem = (row: UnknownRecord): CustomerOrderItem => {
  const product = relation(row.products);
  const image = relation(product.product_images);
  return {
    id: readString(row, "id"),
    productId: readString(row, "product_id"),
    variantId: readString(row, "variant_id"),
    productName: readString(row, "product_name_snapshot"),
    sku: readString(row, "sku_snapshot"),
    color: readString(row, "color_snapshot"),
    size: readString(row, "size_snapshot"),
    quantity: readNumber(row, "quantity"),
    unitPriceInCents: cents(row.unit_price),
    totalInCents: cents(row.total),
    slug: readString(product, "slug"),
    image: publicImage(readString(image, "storage_path"))
  };
};

export async function loadCustomerAccount(): Promise<CustomerAccountSnapshot> {
  const cookieStore = await cookies();
  const demoSession = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);

  if (demoSession) {
    if (!demoSession.roles.includes("customer")) {
      return {
        ...emptyCustomerAccount(),
        panelDestination: demoDestination(demoSession.role)
      };
    }
    const snapshot = emptyCustomerAccount({
      id: `demo:${demoSession.email}`,
      fullName: demoSession.fullName,
      email: demoSession.email,
      status: "active"
    });
    return {
      ...snapshot,
      authenticated: true,
      demo: true,
      warning: ""
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return emptyCustomerAccount();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) return emptyCustomerAccount();
  const rolesResponse = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  const roles = readRows(readQueryResult(rolesResponse).data).map((row) =>
    readString(row, "role")
  );
  const internalRole = roles.find((role) =>
    ["admin", "manager", "operational", "technical"].includes(role)
  );
  if (internalRole) {
    return {
      ...emptyCustomerAccount(),
      panelDestination: demoDestination(
        internalRole as "admin" | "manager" | "operational" | "technical"
      )
    };
  }

  const [
    profileResponse,
    addressesResponse,
    ordersResponse,
    favoritesResponse,
    reviewsResponse,
    returnsResponse,
    notificationsResponse,
    couponsResponse,
    applicationResponse,
    representativeResponse
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,email_snapshot,phone,avatar_path,status,birth_date,cpf_last_four,created_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("addresses")
      .select("id,label,recipient_name,postal_code,street,number,complement,district,city,state,is_default")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id,public_code,status,payment_status,subtotal,discount_total,shipping_total,grand_total,shipping_address_snapshot,cpf_last_four,placed_at,created_at")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("favorites")
      .select("product_id,created_at,products(id,name,slug,status,base_price,product_images(storage_path,is_primary,sort_order),product_variants(id,color_name,size,active,price_override,inventory(available_quantity,reserved_quantity)))")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id,order_item_id,product_id,rating,title,content,status,created_at,products(name)")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("returns")
      .select("id,public_code,order_id,reason,description,requested_resolution,status,requested_at,orders(public_code)")
      .eq("customer_id", user.id)
      .order("requested_at", { ascending: false }),
    supabase
      .from("notifications")
      .select("id,type,title,body,read_at,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("coupon_redemptions")
      .select("id,discount_amount,redeemed_at,coupons(code,name),orders(public_code)")
      .eq("customer_id", user.id)
      .order("redeemed_at", { ascending: false }),
    supabase
      .from("representative_applications")
      .select("public_code,status,submitted_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("representatives")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle()
  ]);

  const profile = record(readQueryResult(profileResponse).data);
  const orderRows = readRows(readQueryResult(ordersResponse).data);
  const orderIds = orderRows.map((item) => readString(item, "id")).filter(Boolean);

  const [itemsResponse, paymentResponse, shipmentResponse, historyResponse] =
    orderIds.length > 0
      ? await Promise.all([
          supabase
            .from("order_items")
            .select("id,order_id,product_id,variant_id,product_name_snapshot,sku_snapshot,color_snapshot,size_snapshot,quantity,unit_price,total,products(slug,product_images(storage_path,is_primary,sort_order))")
            .in("order_id", orderIds),
          supabase
            .from("payments")
            .select("id,order_id,provider,status,payment_method_summary,paid_at,created_at")
            .in("order_id", orderIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("shipments")
            .select("id,order_id,provider,service,status,tracking_code,dispatched_at,delivered_at,tracking_events(id,status,description,location_summary,occurred_at)")
            .in("order_id", orderIds)
            .order("created_at", { ascending: false }),
          supabase
            .from("order_status_history")
            .select("id,order_id,new_status,reason,created_at")
            .in("order_id", orderIds)
            .order("created_at", { ascending: true })
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const itemRows = readRows(readQueryResult(itemsResponse).data);
  const paymentRows = readRows(readQueryResult(paymentResponse).data);
  const shipmentRows = readRows(readQueryResult(shipmentResponse).data);
  const historyRows = readRows(readQueryResult(historyResponse).data);

  const orders: CustomerOrder[] = orderRows.map((row) => {
    const id = readString(row, "id");
    const payment = paymentRows.find((entry) => readString(entry, "order_id") === id);
    const shipment = shipmentRows.find((entry) => readString(entry, "order_id") === id);
    const trackingRows = shipment ? readRows(shipment.tracking_events) : [];
    return {
      id,
      publicCode: readString(row, "public_code"),
      status: readString(row, "status"),
      paymentStatus: readString(row, "payment_status"),
      subtotalInCents: cents(row.subtotal),
      discountInCents: cents(row.discount_total),
      shippingInCents: cents(row.shipping_total),
      totalInCents: cents(row.grand_total),
      placedAt: readString(row, "placed_at") || readString(row, "created_at"),
      address: record(row.shipping_address_snapshot),
      items: itemRows
        .filter((entry) => readString(entry, "order_id") === id)
        .map(mapOrderItem),
      payment: payment
        ? {
            provider: readString(payment, "provider"),
            method: readString(payment, "payment_method_summary"),
            status: readString(payment, "status"),
            paidAt: readString(payment, "paid_at")
          }
        : null,
      shipment: shipment
        ? {
            provider: readString(shipment, "provider"),
            service: readString(shipment, "service"),
            status: readString(shipment, "status"),
            trackingCode: readString(shipment, "tracking_code"),
            dispatchedAt: readString(shipment, "dispatched_at"),
            deliveredAt: readString(shipment, "delivered_at"),
            events: trackingRows.map((event) => ({
              id: readString(event, "id"),
              status: readString(event, "status"),
              description: readString(event, "description"),
              location: readString(event, "location_summary"),
              occurredAt: readString(event, "occurred_at")
            }))
          }
        : null,
      history: historyRows
        .filter((entry) => readString(entry, "order_id") === id)
        .map((entry) => ({
          id: readString(entry, "id"),
          status: readString(entry, "new_status"),
          reason: readString(entry, "reason"),
          createdAt: readString(entry, "created_at")
        }))
    };
  });

  const reviewRows = readRows(readQueryResult(reviewsResponse).data);
  const reviewedItemIds = new Set(
    reviewRows.map((row) => readString(row, "order_item_id")).filter(Boolean)
  );
  const deliveredOrders = new Map(
    orders
      .filter((order) => order.status === "delivered")
      .map((order) => [order.id, order] as const)
  );
  const pendingReviews = itemRows
    .filter(
      (item) =>
        deliveredOrders.has(readString(item, "order_id")) &&
        !reviewedItemIds.has(readString(item, "id"))
    )
    .map((item) => ({
      orderItemId: readString(item, "id"),
      productId: readString(item, "product_id"),
      productName: readString(item, "product_name_snapshot"),
      deliveredAt:
        deliveredOrders.get(readString(item, "order_id"))?.shipment?.deliveredAt ??
        deliveredOrders.get(readString(item, "order_id"))?.placedAt ??
        ""
    }));

  let avatarUrl = "";
  const avatarPath = readString(profile, "avatar_path");
  if (avatarPath) {
    const signed = await supabase.storage.from("customer-private").createSignedUrl(avatarPath, 300);
    avatarUrl = signed.data?.signedUrl ?? "";
  }

  const favoriteRows = readRows(readQueryResult(favoritesResponse).data);
  const favorites = favoriteRows.map((row) => {
    const product = relation(row.products);
    const images = readRows(product.product_images).sort(
      (a, b) =>
        Number(b.is_primary === true) - Number(a.is_primary === true) ||
        readNumber(a, "sort_order") - readNumber(b, "sort_order")
    );
    const variants = readRows(product.product_variants);
    const variant =
      variants.find((entry) => {
        const inventory = relation(entry.inventory);
        return (
          entry.active === true &&
          readNumber(inventory, "available_quantity") > 0
        );
      }) ?? variants[0] ?? {};
    const inventory = relation(variant.inventory);
    const stock = Math.max(
      0,
      readNumber(inventory, "available_quantity")
    );
    return {
      productId: readString(row, "product_id"),
      name: readString(product, "name"),
      slug: readString(product, "slug"),
      image: publicImage(readString(images[0] ?? {}, "storage_path")),
      priceInCents: cents(variant.price_override ?? product.base_price),
      stock,
      color: readString(variant, "color_name"),
      size: readString(variant, "size"),
      variantId: readString(variant, "id"),
      available: readString(product, "status") === "active" && stock > 0
    };
  });

  const application = record(readQueryResult(applicationResponse).data);
  const representative = record(readQueryResult(representativeResponse).data);
  const warningResponses = [
    profileResponse,
    addressesResponse,
    ordersResponse,
    favoritesResponse,
    reviewsResponse,
    returnsResponse,
    notificationsResponse,
    couponsResponse
  ];
  const hasError = warningResponses.some(
    (response) => Boolean(readQueryResult(response).error)
  );

  return {
    authenticated: true,
    demo: false,
    panelDestination: "",
    profile: {
      id: user.id,
      fullName:
        readString(profile, "full_name") ||
        (typeof user.user_metadata.full_name === "string"
          ? user.user_metadata.full_name
          : "Cliente curti Z"),
      email: readString(profile, "email_snapshot") || user.email || "",
      phone: readString(profile, "phone"),
      avatarUrl,
      cpfLastFour:
        readString(profile, "cpf_last_four") ||
        orders.map((order) => record(orderRows.find((row) => readString(row, "id") === order.id))).map((row) => readString(row, "cpf_last_four")).find(Boolean) ||
        "",
      birthDate: readString(profile, "birth_date"),
      status: readString(profile, "status") || "active",
      createdAt: readString(profile, "created_at") || user.created_at,
      lastSignInAt: user.last_sign_in_at ?? ""
    },
    addresses: readRows(readQueryResult(addressesResponse).data).map(mapAddress),
    orders,
    favorites,
    reviews: reviewRows.map((row) => ({
      id: readString(row, "id"),
      orderItemId: readString(row, "order_item_id"),
      productId: readString(row, "product_id"),
      productName: readString(relation(row.products), "name"),
      rating: readNumber(row, "rating"),
      title: readString(row, "title"),
      content: readString(row, "content"),
      status: readString(row, "status"),
      createdAt: readString(row, "created_at")
    })),
    pendingReviews,
    returns: readRows(readQueryResult(returnsResponse).data).map((row) => ({
      id: readString(row, "id"),
      publicCode: readString(row, "public_code"),
      orderId: readString(row, "order_id"),
      orderCode: readString(relation(row.orders), "public_code"),
      reason: readString(row, "reason"),
      description: readString(row, "description"),
      resolution: readString(row, "requested_resolution"),
      status: readString(row, "status"),
      requestedAt: readString(row, "requested_at")
    })),
    notifications: readRows(readQueryResult(notificationsResponse).data).map((row) => ({
      id: readString(row, "id"),
      type: readString(row, "type"),
      title: readString(row, "title"),
      body: readString(row, "body"),
      readAt: readString(row, "read_at"),
      createdAt: readString(row, "created_at")
    })),
    coupons: readRows(readQueryResult(couponsResponse).data).map((row) => ({
      id: readString(row, "id"),
      code: readString(relation(row.coupons), "code"),
      name: readString(relation(row.coupons), "name"),
      discountInCents: cents(row.discount_amount),
      redeemedAt: readString(row, "redeemed_at"),
      orderCode: readString(relation(row.orders), "public_code")
    })),
    representative: {
      applicationStatus: readString(application, "status"),
      applicationCode: readString(application, "public_code"),
      applicationSubmittedAt: readString(application, "submitted_at"),
      applicationUpdatedAt: readString(application, "updated_at"),
      representativeStatus: readString(representative, "status"),
      approved: ["approved_waiting_kit", "active", "unqualified"].includes(
        readString(representative, "status")
      )
    },
    warning: hasError
      ? "Alguns dados não puderam ser carregados agora. Tente atualizar a página."
      : ""
  };
}
