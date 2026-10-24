import { BlingError, blingFiscalMirrorHash, buildBlingFiscalMirror, buildBlingOrderFiscalMirror, expandBlingFiscalKit, selectBlingFiscalRule } from "@curtiz/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeBlingTechnicalRequest } from "@/lib/bling-server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { safeTechnicalOrigin, technicalNoStore, unauthorizedTechnicalResponse } from "@/lib/technical-api";

const creditFields = { saleDate: z.iso.date().optional(), stateRegistrationActive: z.boolean().optional(),
  recipientTaxRegime: z.enum(["normal", "simples", "unknown"]).optional(),
  goodsPurpose: z.enum(["resale", "industrialization", "other"]).optional() };
const schema = z.union([z.object({ ...creditFields, variantId: z.uuid(), quantity: z.number().int().min(1).max(99), destinationState: z.string().regex(/^[A-Z]{2}$/u),
  icmsTaxpayer: z.boolean(), finalConsumer: z.boolean().optional(), creditEligible: z.boolean().optional(), recipientIsCompany: z.boolean().optional(),
  operation: z.enum(["sale", "return"]), originalInvoiceKey: z.string().regex(/^\d{44}$/u).optional() }).strict(),
z.object({ ...creditFields, orderId: z.uuid(), icmsTaxpayer: z.boolean(), finalConsumer: z.boolean(), creditEligible: z.boolean().optional(), recipientIsCompany: z.boolean().optional() }).strict()]);
const text = (value: unknown) => typeof value === "string" ? value : "";
const row = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function POST(request: NextRequest) {
  if (!safeTechnicalOrigin(request)) return NextResponse.json({ message: "Origem não permitida." }, { status: 403, headers: technicalNoStore });
  if (!await authorizeBlingTechnicalRequest(request)) return unauthorizedTechnicalResponse(request);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ message: "Dados da prévia inválidos." }, { status: 400, headers: technicalNoStore });
  const db = createServiceSupabaseClient();
  if (!db) return NextResponse.json({ message: "Prévia indisponível." }, { status: 503, headers: technicalNoStore });
  try {
    if ("orderId" in input.data) {
      const [rules, orderResult, itemsResult] = await Promise.all([db.rpc("read_bling_fiscal_rules"),
        db.from("orders").select("id,customer_id,customer_name_snapshot,customer_email_snapshot,cpf_ciphertext,shipping_address_snapshot,shipping_total,discount_total,fee_total,grand_total").eq("id", input.data.orderId).maybeSingle(),
        db.from("order_items").select("variant_id,sku_snapshot,product_name_snapshot,quantity,unit_price").eq("order_id", input.data.orderId)]);
      if (rules.error || orderResult.error || itemsResult.error || !orderResult.data || !Array.isArray(itemsResult.data))
        throw new BlingError("order_preview_unavailable", 409);
      const items = itemsResult.data.map(row), snapshots: Record<string, unknown>[] = [];
      for (const item of items) {
        const result = await db.rpc("read_bling_catalog_variant", { p_variant_id: item.variant_id });
        if (result.error) throw new BlingError("storage_unavailable", 503);
        snapshots.push(row(result.data));
      }
      const mirror = await buildBlingOrderFiscalMirror({ rules: rules.data, order: row(orderResult.data), items, snapshots,
        icmsTaxpayer: input.data.icmsTaxpayer, finalConsumer: input.data.finalConsumer,
        creditEligible: input.data.creditEligible, recipientIsCompany: input.data.recipientIsCompany,
        saleDate: input.data.saleDate, stateRegistrationActive: input.data.stateRegistrationActive,
        recipientTaxRegime: input.data.recipientTaxRegime, goodsPurpose: input.data.goodsPurpose });
      return NextResponse.json({ mirror, hash: await blingFiscalMirrorHash(mirror) }, { headers: technicalNoStore });
    }
    const [rules, snapshot] = await Promise.all([db.rpc("read_bling_fiscal_rules"), db.rpc("read_bling_catalog_variant", { p_variant_id: input.data.variantId })]);
    if (rules.error || snapshot.error) throw new BlingError("storage_unavailable", 503);
    const value = row(snapshot.data), product = row(value.product), variant = row(value.variant), metadata = row(value.metadata);
    const rule = selectBlingFiscalRule(rules.data, input.data);
    const mirror = buildBlingFiscalMirror(rule, expandBlingFiscalKit({ sku: text(variant.sku), description: text(product.name),
      quantity: input.data.quantity, unitPriceInCents: Math.round(Number(variant.price_override ?? product.base_price) * 100),
      unit: text(metadata.commercial_unit), pairsPerSku: Number(metadata.pairs_per_sku), fiscalUnitApproved: metadata.fiscal_unit_approved === true,
      ncm: text(metadata.ncm), origin: Number(metadata.origin), cest: text(metadata.cest) }, value.kit_components), input.data);
    return NextResponse.json({ mirror, hash: await blingFiscalMirrorHash(mirror) }, { headers: technicalNoStore });
  } catch (error) {
    return NextResponse.json({ message: "Prévia não disponível. Confira o cadastro e as regras recebidas.",
      code: error instanceof BlingError ? error.code : "fiscal_preview_failed" }, { status: 409, headers: technicalNoStore });
  }
}

