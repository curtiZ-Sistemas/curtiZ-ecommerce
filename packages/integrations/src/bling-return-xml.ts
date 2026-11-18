import "server-only";
import { SaxesParser } from "saxes";
import { BlingError } from "./bling";
import type { BlingFiscalItem } from "./bling-kit-fiscal";

const namespace = "http://www.portalfiscal.inf.br/nfe";
export const BLING_RETURN_XML_LIMIT = 2_000_000;
type Node = { name: string; uri: string; attributes: Record<string, string>; text: string; children: Node[] };
const fail = (): never => { throw new BlingError("original_invoice_xml_invalid", 409); };
const children = (node: Node, name: string) => node.children.filter(child => child.uri === namespace && child.name === name);
const one = (node: Node, name: string): Node => {
  const matches = children(node, name);
  return matches.length === 1 ? matches[0]! : fail();
};
const value = (node: Node, name: string) => {
  const child = one(node, name);
  return child.children.length === 0 ? child.text.trim() : fail();
};
const integer = (text: string) => {
  if (!/^\d+(?:\.0+)?$/u.test(text)) return fail();
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : fail();
};
const money = (text: string) => {
  if (!/^\d+(?:\.\d{1,10})?$/u.test(text)) return fail();
  const [whole, fraction = ""] = text.split(".");
  if (/[1-9]/u.test(fraction.slice(2))) return fail();
  const number = Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2)));
  return Number.isSafeInteger(number) ? number : fail();
};
const optionalMoney = (node: Node, name: string) => {
  const matches = children(node, name);
  return matches.length === 0 ? 0 : money(value(node, name));
};

// This reads an archive already obtained from the provider. It does not claim
// independent XML signature verification, accept uploads, or fetch XML resources.
function parseAuthorizedBlingInvoice(xml: string, invoiceKey: string) {
  if (!/^\d{44}$/u.test(invoiceKey) || new TextEncoder().encode(xml).length > BLING_RETURN_XML_LIMIT
    || /<!DOCTYPE|<!ENTITY/iu.test(xml)) return fail();
  const stack: Node[] = [];
  let root: Node | undefined, nodes = 0;
  try {
    const parser = new SaxesParser({ xmlns: true });
    parser.on("error", fail);
    parser.on("doctype", fail);
    parser.on("opentag", tag => {
      if (++nodes > 80_000 || stack.length >= 40) return fail();
      const attributes: Record<string, string> = {};
      for (const attribute of Object.values(tag.attributes)) {
        if (!attribute.uri) attributes[attribute.local] = attribute.value;
      }
      const node: Node = { name: tag.local, uri: tag.uri, attributes, text: "", children: [] };
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else if (root) return fail();
      else root = node;
      stack.push(node);
    });
    const addText = (text: string) => {
      const node = stack.at(-1);
      if (node) { node.text += text; if (node.text.length > 16_384) fail(); }
    };
    parser.on("text", addText);
    parser.on("cdata", addText);
    parser.on("closetag", () => { stack.pop(); });
    parser.write(xml).close();
  } catch { return fail(); }
  if (!root || root.name !== "nfeProc" || root.uri !== namespace || stack.length) return fail();
  const nfe = one(root, "NFe");
  if (root.attributes.versao !== "4.00" || nfe.children.some(child => !(child.uri === namespace && child.name === "infNFe")
    && !(child.uri === "http://www.w3.org/2000/09/xmldsig#" && child.name === "Signature"))) return fail();
  const info = one(nfe, "infNFe"), protocol = one(one(root, "protNFe"), "infProt");
  const ide = one(info, "ide"), recipient = one(info, "dest");
  const environment = value(ide, "tpAmb");
  if (info.attributes.versao !== "4.00" || info.attributes.Id !== `NFe${invoiceKey}` || value(protocol, "chNFe") !== invoiceKey
    || !["100", "150"].includes(value(protocol, "cStat")) || !/^\d{15}$/u.test(value(protocol, "nProt"))
    || !["1", "2"].includes(environment) || value(protocol, "tpAmb") !== environment) return fail();
  return { info, ide, recipient, protocol, environment };
}

type ArchiveExpectation = { invoiceNumber: string; series: number; issuerDocument: string; totalInCents: number };
function assertBlingArchiveIdentity(info: Node, ide: Node, invoiceKey: string, expectedArchive: ArchiveExpectation) {
  if (value(ide, "mod") !== "55" || invoiceKey.slice(20, 22) !== "55"
    || value(one(info, "emit"), "CNPJ") !== expectedArchive.issuerDocument
    || invoiceKey.slice(6, 20) !== expectedArchive.issuerDocument
    || Number(value(ide, "serie")) !== expectedArchive.series || Number(invoiceKey.slice(22, 25)) !== expectedArchive.series
    || !/^\d{1,9}$/u.test(expectedArchive.invoiceNumber) || Number(expectedArchive.invoiceNumber) < 1
    || Number(value(ide, "nNF")) !== Number(expectedArchive.invoiceNumber)
    || Number(invoiceKey.slice(25, 34)) !== Number(expectedArchive.invoiceNumber))
    throw new BlingError("fiscal_archive_identity_mismatch", 409);
}

function readBlingInvoiceItems(info: Node, expectedTotal?: number) {
  const details = children(info, "det");
  if (!details.length || details.length > 990) return fail();
  const itemAllocationsInCents: { shippingInCents: number; discountInCents: number; additionalInCents: number }[] = [];
  const items: BlingFiscalItem[] = details.map((detail, index) => {
    if (detail.attributes.nItem !== String(index + 1)) return fail();
    const product = one(detail, "prod"), tax = one(one(detail, "imposto"), "ICMS");
    const groups = tax.children.filter(child => child.uri === namespace);
    if (groups.length !== 1 || optionalMoney(product, "vSeg") !== 0) return fail();
    const quantity = integer(value(product, "qCom")), unitPriceInCents = money(value(product, "vUnCom"));
    if (quantity < 1 || value(product, "uCom") !== "PR" || value(product, "indTot") !== "1"
      || !Number.isSafeInteger(quantity * unitPriceInCents) || quantity * unitPriceInCents !== money(value(product, "vProd"))) return fail();
    const sku = value(product, "cProd"), description = value(product, "xProd"), ncm = value(product, "NCM");
    const origin = integer(value(groups[0]!, "orig"));
    const cest = children(product, "CEST").length ? value(product, "CEST") : "";
    if (!sku || sku.length > 60 || !description || !/^\d{8}$/u.test(ncm) || origin > 8 || !/^(?:|\d{7})$/u.test(cest)) return fail();
    const extras = children(detail, "infAdProd");
    if (extras.length > 1 || extras[0]?.children.length) return fail();
    const additionalInfo = extras[0]?.text.trim() ?? "";
    const sourceCommercialSku = additionalInfo.startsWith("SKU comercial: ") ? additionalInfo.slice(15) : undefined;
    if (sourceCommercialSku !== undefined && (!sourceCommercialSku || sourceCommercialSku.length > 200)) return fail();
    itemAllocationsInCents.push({ shippingInCents: optionalMoney(product, "vFrete"),
      discountInCents: optionalMoney(product, "vDesc"), additionalInCents: optionalMoney(product, "vOutro") });
    return { sku, description, unit: "PR", quantity, unitPriceInCents, ncm, origin, cest,
      pairsPerSku: 1, fiscalUnitApproved: true, ...(sourceCommercialSku ? { sourceCommercialSku } : {}) };
  });
  const totals = one(one(info, "total"), "ICMSTot");
  const amounts = { shippingInCents: money(value(totals, "vFrete")), discountInCents: money(value(totals, "vDesc")),
    additionalInCents: money(value(totals, "vOutro")) };
  const gross = items.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPriceInCents), 0n);
  const totalInCents = money(value(totals, "vNF"));
  if (expectedTotal !== undefined && totalInCents !== expectedTotal)
    throw new BlingError("fiscal_archive_identity_mismatch", 409);
  if (optionalMoney(totals, "vSeg") !== 0 || gross !== BigInt(money(value(totals, "vProd")))
    || gross + BigInt(amounts.shippingInCents) + BigInt(amounts.additionalInCents) - BigInt(amounts.discountInCents) !== BigInt(totalInCents)
    || Object.keys(amounts).some(key => {
      const field = key as keyof typeof amounts;
      return itemAllocationsInCents.reduce((sum, item) => sum + BigInt(item[field]), 0n) !== BigInt(amounts[field]);
    })) return fail();
  return { items, itemAllocationsInCents, ...amounts, totalInCents };
}

export function readBlingReturnOriginalXml(xml: string, invoiceKey: string, expectedArchive?: ArchiveExpectation) {
  const { info, ide, recipient, environment } = parseAuthorizedBlingInvoice(xml, invoiceKey);
  if (value(ide, "tpNF") !== "1" || value(ide, "finNFe") !== "1"
    || value(ide, "indFinal") !== "1" || value(recipient, "indIEDest") !== "9"
    || !/^\d{11}$/u.test(value(recipient, "CPF")) || children(recipient, "CNPJ").length) return fail();
  if (expectedArchive) assertBlingArchiveIdentity(info, ide, invoiceKey, expectedArchive);
  const destinationState = value(one(recipient, "enderDest"), "UF");
  if (!/^[A-Z]{2}$/u.test(destinationState)) return fail();
  return { invoiceKey, ...readBlingInvoiceItems(info, expectedArchive?.totalInCents),
    destinationState, environment: Number(environment) };
}

type ResaleInvoiceLine = Pick<BlingFiscalItem, "sku" | "unit" | "quantity" | "unitPriceInCents" | "ncm" | "origin" | "cest"> & {
  cfop: string;
  csosn: string;
  icms: Record<string, string>;
  shippingInCents: number;
};

export type BlingResaleInvoiceExpectation = ArchiveExpectation & {
  environment: 1 | 2;
  issueDate: string;
  buyerDocument: string;
  buyerStateRegistration: string;
  destinationPostalCode: string;
  deliveryPostalCode?: string;
  originPostalCode: string;
  shippingInCents: number;
  additionalInfo?: string;
  items: ResaleInvoiceLine[];
};

const fiscalDecimal = (entry: string) => /^\d+(?:\.\d+)?$/u.test(entry)
  ? entry.replace(/^(0+)(?=\d)/u, "").replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "") : null;

// Validate the XML downloaded from Bling against the paid order and its approved
// tax parameters. Every ICMS tag must match the configured fiscal mirror.
export function readBlingAuthorizedResaleXml(xml: string, invoiceKey: string, expected: BlingResaleInvoiceExpectation) {
  const { info, ide, recipient, protocol, environment } = parseAuthorizedBlingInvoice(xml, invoiceKey);
  assertBlingArchiveIdentity(info, ide, invoiceKey, expected);
  const emitter = one(info, "emit");
  const destination = one(recipient, "enderDest");
  const pickup = children(info, "retirada").length ? one(info, "retirada") : one(emitter, "enderEmit");
  if (expected.series !== 2 || environment !== String(expected.environment)
    || value(ide, "cUF") !== "31" || invoiceKey.slice(0, 2) !== "31"
    || value(ide, "tpNF") !== "1" || value(ide, "finNFe") !== "1" || value(ide, "idDest") !== "1"
    || value(ide, "indFinal") !== "0" || value(ide, "indPres") !== "2" || value(recipient, "indIEDest") !== "1"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(expected.issueDate)
    || value(ide, "dhEmi").slice(0, 10) !== expected.issueDate
    || !/^\d{14}$/u.test(expected.buyerDocument) || value(recipient, "CNPJ") !== expected.buyerDocument
    || !/^\d{2,14}$/u.test(expected.buyerStateRegistration) || value(recipient, "IE") !== expected.buyerStateRegistration
    || children(recipient, "CPF").length || value(destination, "UF") !== "MG"
    || !/^3\d{7}$/u.test(expected.destinationPostalCode) || value(destination, "CEP") !== expected.destinationPostalCode
    || value(one(emitter, "enderEmit"), "UF") !== "MG" || value(pickup, "UF") !== "MG"
    || value(pickup, "cMun") !== "3145208"
    || !/^3\d{7}$/u.test(expected.originPostalCode) || value(pickup, "CEP") !== expected.originPostalCode) return fail();
  const delivery = expected.deliveryPostalCode ?? expected.destinationPostalCode;
  if (delivery !== expected.destinationPostalCode || children(info,"entrega").length) {
    const place = one(info,"entrega");
    if (!/^3\d{7}$/u.test(delivery) || value(place,"UF") !== "MG" || value(place,"CEP") !== delivery) return fail();
  }
  const invoice = readBlingInvoiceItems(info, expected.totalInCents);
  if (expected.additionalInfo && !value(one(info, "infAdic"), "infCpl").includes(expected.additionalInfo)) return fail();
  const details = children(info, "det");
  if (invoice.shippingInCents !== expected.shippingInCents || invoice.items.length !== expected.items.length
    || invoice.discountInCents !== 0 || invoice.additionalInCents !== 0) return fail();
  for (const [index, item] of invoice.items.entries()) {
    const line = expected.items[index]!;
    const detail = details[index]!;
    const product = one(detail, "prod");
    const groups = one(one(detail, "imposto"), "ICMS").children.filter(child => child.uri === namespace);
    const group = groups[0]!;
    const fields = group.children.filter(child => child.uri === namespace);
    const approved = { ...line.icms, orig: String(line.origin), CSOSN: line.csosn };
    if (item.sku !== line.sku || item.unit !== line.unit || item.quantity !== line.quantity
      || item.unitPriceInCents !== line.unitPriceInCents || item.ncm !== line.ncm || item.cest !== line.cest
      || item.origin !== line.origin || !/^5\d{3}$/u.test(line.cfop) || value(product, "CFOP") !== line.cfop
      || !/^\d{3}$/u.test(line.csosn) || !/^ICMSSN\d{3}$/u.test(group.name)
      || fields.length !== Object.keys(approved).length
      || Object.entries(approved).some(([key, expectedValue]) => {
        const actual = value(group, key);
        if (!/^[pv][A-Z]/u.test(key)) return actual !== expectedValue;
        const expectedNumber = fiscalDecimal(expectedValue);
        return expectedNumber === null || fiscalDecimal(actual) !== expectedNumber;
      })
      || invoice.itemAllocationsInCents[index]?.shippingInCents !== line.shippingInCents) return fail();
  }
  return { invoiceKey, protocol: value(protocol, "nProt"), environment: Number(environment), ...invoice };
}

type ResaleReturnExpectation = {
  origin: "buyer_outflow" | "own_inflow";
  environment: 1 | 2;
  issuerDocument: string;
  buyerDocument: string;
  originalKey: string;
  originalKitQuantity: number;
  returnKitQuantity: number;
  cfop: string;
  taxCodeKind: "CST" | "CSOSN";
  taxCode: string;
  refundInCents: number;
};

export function readBlingAuthorizedResaleReturnXml(xml: string, key: string, originalXml: string, expected: ResaleReturnExpectation) {
  const original = parseAuthorizedBlingInvoice(originalXml, expected.originalKey);
  const returned = parseAuthorizedBlingInvoice(xml, key);
  const own = expected.origin === "own_inflow";
  const supplier = expected.issuerDocument;
  const buyer = expected.buyerDocument;
  const emitter = one(returned.info, "emit");
  const invoiceNumber = value(returned.ide, "nNF");
  const series = own ? 3 : integer(value(returned.ide, "serie"));
  const referenced = value(one(returned.ide, "NFref"), "refNFe");
  if (original.environment !== returned.environment
    || returned.environment !== String(expected.environment) || key === expected.originalKey || referenced !== expected.originalKey
    || key.slice(0, 2) !== "31" || value(returned.ide, "cUF") !== "31" || value(returned.ide, "idDest") !== "1"
    || value(returned.ide, "tpNF") !== (own ? "0" : "1") || value(returned.ide, "finNFe") !== "4"
    || value(one(emitter, "enderEmit"), "UF") !== "MG"
    || value(one(returned.recipient, "enderDest"), "UF") !== "MG"
    || !/^\d{14}$/u.test(buyer) || !/^\d{14}$/u.test(supplier) || buyer === supplier
    || value(returned.recipient, "CNPJ") !== (own ? buyer : supplier)
    || value(one(original.info, "emit"), "CNPJ") !== supplier || value(original.recipient, "CNPJ") !== buyer
    || value(original.ide, "finNFe") !== "1" || value(original.ide, "indFinal") !== "0"
    || !(own ? /^1\d{3}$/u : /^5\d{3}$/u).test(expected.cfop)
    || !(expected.taxCodeKind === "CST" ? /^\d{2}$/u : /^\d{3}$/u).test(expected.taxCode)
    || !Number.isSafeInteger(expected.originalKitQuantity) || !Number.isSafeInteger(expected.returnKitQuantity)
    || expected.returnKitQuantity < 1 || expected.returnKitQuantity > expected.originalKitQuantity
    || !Number.isSafeInteger(expected.refundInCents) || expected.refundInCents < 1) return fail();

  assertBlingArchiveIdentity(returned.info, returned.ide, key, { invoiceNumber, series,
    issuerDocument: own ? supplier : buyer, totalInCents: expected.refundInCents });
  const sale = readBlingInvoiceItems(original.info);
  const residual = readBlingInvoiceItems(returned.info, expected.refundInCents);
  if (sale.items.length !== residual.items.length || residual.discountInCents !== 0 || residual.additionalInCents !== 0
    || BigInt(residual.shippingInCents) * BigInt(expected.originalKitQuantity)
      > BigInt(sale.shippingInCents) * BigInt(expected.returnKitQuantity) + BigInt(expected.originalKitQuantity - 1)) return fail();
  const signature = (item: BlingFiscalItem) => JSON.stringify([item.sku, item.unit, item.unitPriceInCents, item.ncm, item.origin, item.cest]);
  const remaining = new Map<string, number>();
  for (const item of sale.items) {
    const line = signature(item);
    const quantity = item.quantity * expected.returnKitQuantity / expected.originalKitQuantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || remaining.has(line)) return fail();
    remaining.set(line, quantity);
  }
  for (const [index, item] of residual.items.entries()) {
    const detail = children(returned.info,"det")[index]!;
    const tax = one(one(detail,"imposto"),"ICMS").children.filter(child => child.uri === namespace)[0]!;
    if (remaining.get(signature(item)) !== item.quantity || value(one(detail,"prod"),"CFOP") !== expected.cfop
      || value(tax,expected.taxCodeKind) !== expected.taxCode) return fail();
    remaining.delete(signature(item));
  }
  if (remaining.size) return fail();
  return { protocol: value(returned.protocol,"nProt"), totalInCents: residual.totalInCents, key };
}
