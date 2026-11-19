import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { PrivateRequestError, readPrivateJson, requirePrivateRateLimit } from "@/lib/private-request";
import { commercialKitCheckoutConfigured } from "@/lib/representative-commercial-payments";
import { isRepresentativeKitPostalCode } from "@/lib/representative-resale-scope";
import { KitTransactionError, kitCall } from "@/lib/representative-test-transactions";
import { getStoreRuntimeEnvironment } from "@/lib/runtime-environment";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const common = { addressId: z.string().uuid(), quantity: z.number().int().min(1).max(99) };
const input = z.union([
  z.object({ ...common, variantId: z.string().uuid() }).strict(),
  z.object({ ...common, kitId: z.string().uuid(), template: z.enum(["standard","lower_restock","upper_restock"]) }).strict()
]);
const reply = (data: object, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) return reply({ message: "Origem não autorizada." }, 403);
  try {
    const parsed = input.safeParse(await readPrivateJson(request, 1024));
    if (!parsed.success) return reply({ message: "Revise o kit e o endereço." }, 400);
    const auth = await createServerSupabaseClient();
    const session = await auth?.auth.getUser();
    const user = session?.data.user;
    if (!auth || session?.error || !user) throw new KitTransactionError(401);
    const environment = getStoreRuntimeEnvironment();
    if (environment.REPRESENTATIVE_KIT_COLLECTION_ENABLED !== "true" || !commercialKitCheckoutConfigured(environment)) return reply({ quote: null });
    const origin = environment.MELHOR_ENVIO_ORIGIN_POSTAL_CODE?.trim() ?? "";
    const db = createServiceSupabaseClient();
    if (!db || !isRepresentativeKitPostalCode(origin)) throw new KitTransactionError(503);
    await requirePrivateRateLimit(auth, "shipping_quote");
    const data = parsed.data;
    const quote = await kitCall(db, "quote_representative_kit_collection", {
      p_actor: user.id, p_selection: "variantId" in data ? data.variantId : data.kitId,
      p_template: "template" in data ? data.template : null, p_quantity: data.quantity,
      p_address: data.addressId, p_origin: origin
    });
    return reply({ quote });
  } catch (error) {
    const status = error instanceof KitTransactionError || error instanceof PrivateRequestError ? error.status : 503;
    return reply({ message: "Não foi possível consultar o pagamento no recebimento." }, status);
  }
}
