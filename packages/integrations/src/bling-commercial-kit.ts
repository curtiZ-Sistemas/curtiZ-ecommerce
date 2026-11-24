import "server-only";
import { BlingError, type BlingClient } from "./bling";
import { blingExternalSku } from "./bling-catalog";
import { buildBlingFiscalMirror, selectBlingFiscalRule } from "./bling-fiscal-preview";
import { allocateBlingFiscalCents, expandBlingFiscalKit, type BlingFiscalItem } from "./bling-kit-fiscal";
import { readBlingAuthorizedResaleXml } from "./bling-return-xml";
import { isUnknownRecord, readNumber, readString, type UnknownRecord } from "./record-readers";
import { priceRepresentativeGradeItems } from "./representative-grade-lines";

// Venda de kit/ficha para empresa de MG (regra MG02): a mesma montagem e conferência fiscal serve
// ao pedido do representante (worker da loja) e à nota de atacado emitida no painel.
const row = (value: unknown): UnknownRecord => isUnknownRecord(value) ? value : {};
const id = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const scopeError = () => new BlingError("kit_fiscal_clearance_failed", 409);

export type KitSaleLine = BlingFiscalItem & { variantId: string };
/** Lê o cadastro fiscal de uma variação (RPC read_bling_catalog_variant, só service role). */
export type CatalogVariantReader = (variantId: string) => Promise<UnknownRecord>;

export async function commercialKitFiscalLines(readCatalogVariant: CatalogVariantReader, job: UnknownRecord): Promise<{
  commercial: KitSaleLine[];
  expanded: BlingFiscalItem[];
}> {
  const unitPriceInCents = readNumber(job, "unitPriceInCents");
  const quantity = readNumber(job, "quantity");
  if (Array.isArray(job.gradeLines)) {
    const priced = priceRepresentativeGradeItems(job.gradeLines, unitPriceInCents, quantity);
    const metadataByVariant = new Map<string, UnknownRecord>();
    const commercial: KitSaleLine[] = [];
    for (const item of priced) {
      let metadata = metadataByVariant.get(item.variantId);
      if (!metadata) {
        const catalog = await readCatalogVariant(item.variantId);
        metadata = row(catalog.metadata);
        if (row(catalog.variant).sku !== item.sku || metadata.production_type !== "T"
          || metadata.fiscal_unit_approved !== true || readNumber(metadata, "pairs_per_sku") !== 1
          || readString(metadata, "commercial_unit") !== "PR") throw scopeError();
        metadataByVariant.set(item.variantId, metadata);
      }
      commercial.push({
        sku: item.sku, variantId: item.variantId, description: `${item.name} · Tamanho ${item.size}`,
        quantity: item.quantity, unit: "PR", pairsPerSku: 1, fiscalUnitApproved: true,
        unitPriceInCents: item.unitPriceInCents, ncm: readString(metadata, "ncm"),
        origin: readNumber(metadata, "origin"), cest: readString(metadata, "cest")
      });
    }
    return { commercial, expanded: commercial.map(item => ({ ...item, sku: blingExternalSku(item.sku, item.variantId) })) };
  }

  const variantId = readString(job, "variantId");
  const catalog = await readCatalogVariant(variantId);
  const metadata = row(catalog.metadata);
  if (row(catalog.variant).sku !== job.sku || metadata.production_type !== "T" || metadata.fiscal_unit_approved !== true
    || readNumber(metadata, "pairs_per_sku") < 2) throw scopeError();
  const commercial = {
    sku: readString(job, "sku"), description: readString(job, "productName"), quantity, variantId,
    unit: readString(metadata, "commercial_unit"), pairsPerSku: readNumber(metadata, "pairs_per_sku"), fiscalUnitApproved: true,
    unitPriceInCents, ncm: readString(metadata, "ncm"), origin: readNumber(metadata, "origin"), cest: readString(metadata, "cest")
  };
  return { commercial: [commercial], expanded: expandBlingFiscalKit(commercial, catalog.kit_components) };
}

export async function commercialKitFiscalMirror(readCatalogVariant: CatalogVariantReader, job: UnknownRecord, issueDate: string) {
  const configuration = row(job.fiscalParameters);
  const issuer = readString(configuration, "issuerDocument");
  const buyerProfile = readString(job, "buyerProfile");
  const creditEligible = configuration.creditEligible;
  if (!/^\d{14}$/u.test(issuer) || !["MG01", "MG02"].includes(buyerProfile) || typeof creditEligible !== "boolean"
    || (creditEligible && buyerProfile !== "MG01") || !/^\d{4}-\d{2}-\d{2}$/u.test(issueDate)
    || configuration.classification !== "third_party_no_st") throw scopeError();
  const rule = selectBlingFiscalRule([configuration.blingRule], {
    destinationState: "MG", icmsTaxpayer: true, finalConsumer: false, operation: "sale", creditEligible,
    recipientIsCompany: true, stateRegistrationActive: true, recipientTaxRegime: buyerProfile === "MG01" ? "normal" : "simples",
    goodsPurpose: "resale", saleDate: issueDate
  });
  if ((rule.series !== 2 && rule.series !== 3) || !rule.external_nature_id) throw scopeError();

  const { commercial, expanded } = await commercialKitFiscalLines(readCatalogVariant, job);
  const freight = readNumber(job, "shippingInCents");
  if (rule.series === 3 && freight !== 0) throw scopeError();
  const amounts = expanded.map(item => item.quantity * item.unitPriceInCents);
  const allocations = freight === 0 ? amounts.map(() => 0) : allocateBlingFiscalCents(freight, amounts);
  const base = configuration.creditBase;
  if (creditEligible && base !== "merchandise" && base !== "merchandise_with_shipping") throw scopeError();
  const mirror = buildBlingFiscalMirror(rule, expanded, {
    shippingInCents: freight,
    ...(creditEligible ? { icmsCreditBasesInCents: amounts.map((amount, index) => amount + (base === "merchandise_with_shipping" ? allocations[index]! : 0)) } : {})
  });
  if (!mirror.taxConfiguration || !mirror.items.every(item => item.ncm === "64022000" && item.origin === 0 && item.unit === "PR")
    || (creditEligible && !mirror.icmsCredit) || mirror.totalInCents !== readNumber(job, "amountInCents")) throw scopeError();
  return { issuer, natureId: rule.external_nature_id, rule, commercial, mirror, allocations, freight };
}

/**
 * Confere no Bling e no XML autorizado que a NF-e do kit é a esperada (situação 5, chave 31…, itens,
 * CFOP, CSOSN, destinatário e totais). `reference` é o numeroLoja do pedido de venda.
 */
export async function verifyCommercialKitInvoice(provider: BlingClient, readCatalogVariant: CatalogVariantReader, job: UnknownRecord,
  environment: 1 | 2, input: { reference: string; billingPostalCode: () => Promise<string>; manual?: { key: string; invoice: UnknownRecord } }) {
  const saleId = readNumber(job, "saleId");
  const invoiceId = readNumber(job, "invoiceId");
  const { reference, manual } = input;
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw scopeError();
  if (!manual) {
    if (!Number.isSafeInteger(saleId) || saleId <= 0) throw scopeError();
    const sale = row(row(await provider.request(`/pedidos/vendas/${saleId}`)).data);
    if (Number(sale.id) !== saleId || sale.numeroLoja !== reference || Number(row(sale.notaFiscal).id) !== invoiceId) throw scopeError();
  }
  const invoice = manual?.invoice ?? row(row(await provider.request(`/nfe/${invoiceId}`)).data);
  const key = readString(invoice, "chaveAcesso");
  if (Number(invoice.id) !== invoiceId || Number(invoice.situacao) !== 5
    || (manual ? key !== manual.key : invoice.numeroPedidoLoja && invoice.numeroPedidoLoja !== reference)
    || !/^31\d{42}$/u.test(key)) throw scopeError();
  const issueDate = readString(invoice, "dataEmissao").slice(0, 10);
  const { issuer, natureId, rule, mirror, allocations, freight } = await commercialKitFiscalMirror(readCatalogVariant, job, issueDate);
  const destinationPostalCode = await input.billingPostalCode();
  if (Number(row(invoice.naturezaOperacao).id) !== natureId) throw scopeError();
  const document = await provider.invoiceDocument(key, "xml");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
  const verified = readBlingAuthorizedResaleXml(xml, key, {
    environment, issueDate, invoiceNumber: id(invoice.numero), series: rule.series, issuerDocument: issuer,
    buyerDocument: readString(job, "buyerDocument"), buyerStateRegistration: readString(job, "buyerStateRegistration"),
    originPostalCode: readString(job, "originPostalCode"), destinationPostalCode,
    deliveryPostalCode: readString(job, "postalCode"),
    totalInCents: mirror.totalInCents, shippingInCents: freight, additionalInfo: mirror.icmsCredit?.message,
    items: mirror.items.map((item, index) => {
      const credit = mirror.icmsCredit;
      const icms: Record<string, string> = credit ? {
        pCredSN: credit.rate.toFixed(4), vCredICMSSN: (credit.itemsInCents[index]! / 100).toFixed(2)
      } : {};
      return { ...item, cfop: rule.cfop, csosn: rule.csosn, shippingInCents: allocations[index]!, icms };
    })
  });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", document)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  return { key, protocol: verified.protocol, hash };
}
