import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readBlingReturnOriginalXml, BLING_RETURN_XML_LIMIT } from "./bling-return-xml";
import { returnTestKey as key, returnTestXml } from "./bling-return-test-fixture";

describe("authorized original XML used by return previews", () => {
  it("reads archived integer prices and per-line allocations without recipient data", () => {
    const original = readBlingReturnOriginalXml(returnTestXml(), key);
    expect(original).toMatchObject({ invoiceKey: key, totalInCents: 1200, shippingInCents: 200, discountInCents: 1000,
      destinationState: "SP", environment: 2, itemAllocationsInCents: [{ shippingInCents: 200, discountInCents: 1000, additionalInCents: 0 }] });
    expect(original.items[0]).toMatchObject({ sku: "TEST-PAIR", quantity: 2, unitPriceInCents: 1000, description: "Synthetic pair & test" });
    expect(JSON.stringify(original)).not.toContain("00000000000");
  });
  it.each([
    ['<cStat>100</cStat>', '<cStat>204</cStat>'], ['<tpNF>1</tpNF>', '<tpNF>0</tpNF>'],
    ['<finNFe>1</finNFe>', '<finNFe>4</finNFe>'], ['<indFinal>1</indFinal>', '<indFinal>0</indFinal>'],
    ['<indIEDest>9</indIEDest>', '<indIEDest>1</indIEDest>'], ['<CPF>00000000000</CPF>', '<CNPJ>00000000000000</CNPJ>'],
    ['<uCom>PR</uCom>', '<uCom>UN</uCom>'], ['<qCom>2.0000</qCom>', '<qCom>1.5</qCom>'],
    ['<vUnCom>10.0000000000</vUnCom>', '<vUnCom>10.001</vUnCom>'], ['<vProd>20.00</vProd>', '<vProd>21.00</vProd>'],
    ['<vNF>12.00</vNF>', '<vNF>13.00</vNF>'], ['<vFrete>2.00</vFrete>', '<vFrete>1.00</vFrete>'],
    ['nItem="1"', 'nItem="2"'], ['<NCM>64022000</NCM>', '<NCM>invalid</NCM>'],
    ['<orig>0</orig>', '<orig>9</orig>'], ['<vOutro>0.00</vOutro>', '<vOutro>0.00</vOutro><vSeg>1.00</vSeg>'],
    ['<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>'], ['<vNF>12.00</vNF>', '<vNF>12.00</vNF><vNF>12.00</vNF>'],
    ['<vNF>12.00</vNF>', '<vNF>9007199254740992.00</vNF>'], ['<NFe>', '<NFe><NFe/>']
  ])("rejects unsupported or conflicting XML: %s", (from, to) => {
    expect(() => readBlingReturnOriginalXml(returnTestXml().replace(from, to), key)).toThrow("original_invoice_xml_invalid");
  });
  it.each([
    (xml: string) => xml.replace(`Id="NFe${key}"`, `Id="NFe${"2".repeat(44)}"`),
    (xml: string) => xml.replace(`<chNFe>${key}</chNFe>`, `<chNFe>${"2".repeat(44)}</chNFe>`),
    (xml: string) => xml.replace('xmlns="http://www.portalfiscal.inf.br/nfe"', 'xmlns="urn:other"'),
    (xml: string) => xml.replace('<NFe>', '<NFe xmlns="urn:other">'),
    (xml: string) => xml.replace('</nfeProc>', ''),
    (xml: string) => '<!DOCTYPE nfeProc [<!ENTITY test SYSTEM "https://example.invalid/private">]>' + xml,
    (xml: string) => xml.replace('Synthetic pair &amp; test', '&unknown;'),
    (xml: string) => xml.replace('</infNFe>', '<nested>'.repeat(41) + '</nested>'.repeat(41) + '</infNFe>')
  ])("rejects mismatched identity, namespaces and unsafe XML", change => {
    expect(() => readBlingReturnOriginalXml(change(returnTestXml()), key)).toThrow("original_invoice_xml_invalid");
  });
  it("bounds the XML before parsing", () => {
    expect(() => readBlingReturnOriginalXml(" ".repeat(BLING_RETURN_XML_LIMIT + 1), key)).toThrow("original_invoice_xml_invalid");
  });
});
