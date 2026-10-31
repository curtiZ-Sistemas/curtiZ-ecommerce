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
export function readBlingReturnOriginalXml(xml: string, invoiceKey: string) {
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
    || !["1", "2"].includes(environment) || value(protocol, "tpAmb") !== environment
    || value(ide, "tpNF") !== "1" || value(ide, "finNFe") !== "1"
    || value(ide, "indFinal") !== "1" || value(recipient, "indIEDest") !== "9"
    || !/^\d{11}$/u.test(value(recipient, "CPF")) || children(recipient, "CNPJ").length) return fail();
  const destinationState = value(one(recipient, "enderDest"), "UF");
  if (!/^[A-Z]{2}$/u.test(destinationState)) return fail();
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
  if (optionalMoney(totals, "vSeg") !== 0 || gross !== BigInt(money(value(totals, "vProd")))
    || gross + BigInt(amounts.shippingInCents) + BigInt(amounts.additionalInCents) - BigInt(amounts.discountInCents) !== BigInt(totalInCents)
    || Object.keys(amounts).some(key => {
      const field = key as keyof typeof amounts;
      return itemAllocationsInCents.reduce((sum, item) => sum + BigInt(item[field]), 0n) !== BigInt(amounts[field]);
    })) return fail();
  return { invoiceKey, items, itemAllocationsInCents, ...amounts, totalInCents, destinationState, environment: Number(environment) };
}
