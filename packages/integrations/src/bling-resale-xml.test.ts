import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readBlingAuthorizedResaleReturnXml, readBlingAuthorizedResaleXml, type BlingResaleInvoiceExpectation } from "./bling-return-xml";
import { returnTestKey, returnTestXml } from "./bling-return-test-fixture";

const issuer = "12345678000195";
const key = "312611" + issuer + "55002000000001" + "1".repeat(10);
const expected: BlingResaleInvoiceExpectation = {
  invoiceNumber: "1", series: 2, issuerDocument: issuer, totalInCents: 2200, shippingInCents: 200,
  environment: 2, issueDate: "2026-11-18", buyerDocument: "11222333000181", buyerStateRegistration: "0012345678900",
  destinationPostalCode: "30110100", originPostalCode: "35520000",
  items: [{ sku: "TEST-PAIR", unit: "PR", quantity: 2, unitPriceInCents: 1000, ncm: "64022000", origin: 0,
    cest: "", cfop: "5102", csosn: "102", icms: {}, shippingInCents: 200 }]
};
const xml = () => returnTestXml().replaceAll(returnTestKey, key)
  .replace("</ide>", "<cUF>31</cUF><mod>55</mod><serie>2</serie><nNF>1</nNF><idDest>1</idDest><indPres>2</indPres><dhEmi>2026-11-18T12:00:00-03:00</dhEmi></ide>")
  .replace("<indFinal>1</indFinal>", "<indFinal>0</indFinal>")
  .replace("<dest>", `<emit><CNPJ>${issuer}</CNPJ><enderEmit><UF>MG</UF></enderEmit></emit><dest>`)
  .replace("<CPF>00000000000</CPF><indIEDest>9</indIEDest>", "<CNPJ>11222333000181</CNPJ><indIEDest>1</indIEDest><IE>0012345678900</IE>")
  .replace("<UF>SP</UF>", "<UF>MG</UF><CEP>30110100</CEP>")
  .replace("</dest>", "</dest><retirada><UF>MG</UF><CEP>35520000</CEP><cMun>3145208</cMun></retirada>")
  .replace("<uCom>", "<CFOP>5102</CFOP><uCom>").replaceAll("<vDesc>10.00</vDesc>", "<vDesc>0.00</vDesc>")
  .replace("<vNF>12.00</vNF>", "<vNF>22.00</vNF>");

describe("Bling authorized MG resale invoice", () => {
  it("validates an authorized synthetic business resale document and returns its protocol", () => {
    expect(readBlingAuthorizedResaleXml(xml(), key, expected)).toMatchObject({
      invoiceKey: key, protocol: "000000000000001", environment: 2, shippingInCents: 200, totalInCents: 2200
    });
  });

  it.each([
    ["<cStat>100</cStat>", "<cStat>204</cStat>"],
    ["<indIEDest>1</indIEDest>", "<indIEDest>9</indIEDest>"],
    ["<indFinal>0</indFinal>", "<indFinal>1</indFinal>"],
    ["<CEP>35520000</CEP>", "<CEP>30110100</CEP>"],
    ["<cMun>3145208</cMun>", "<cMun>3106200</cMun>"],
    ["<CFOP>5102</CFOP>", "<CFOP>5405</CFOP>"],
    ["<CSOSN>102</CSOSN>", "<CSOSN>102</CSOSN><pCredSN>1.36</pCredSN>"],
    ["<IE>0012345678900</IE>", "<IE>0012345678901</IE>"],
    ["<serie>2</serie>", "<serie>3</serie>"]
  ])("rejects conflicting fiscal evidence %s", (from, to) => {
    expect(() => readBlingAuthorizedResaleXml(xml().replace(from, to), key, expected)).toThrow();
  });

  it("does not treat a homologation XML as a production authorization", () => {
    expect(() => readBlingAuthorizedResaleXml(xml(), key, { ...expected, environment: 1 })).toThrow();
  });

  it("checks a distinct delivery address without changing the official fiscal recipient", () => {
    const distinct = { ...expected, deliveryPostalCode: "30110200" };
    expect(() => readBlingAuthorizedResaleXml(xml(), key, distinct)).toThrow();
    const withDelivery = xml().replace("</retirada>", "</retirada><entrega><UF>MG</UF><CEP>30110200</CEP></entrega>");
    expect(readBlingAuthorizedResaleXml(withDelivery, key, distinct)).toMatchObject({ invoiceKey: key });
    expect(() => readBlingAuthorizedResaleXml(withDelivery.replace("<CEP>30110200</CEP>", "<CEP>01310100</CEP>"), key, distinct)).toThrow();
  });
});

describe("authorized resale returns", () => {
  const returnKey = "312611" + issuer + "55003000000002" + "2".repeat(10);
  const returnExpected = {
    origin: "own_inflow" as const, environment: 2 as const, issuerDocument: issuer, buyerDocument: expected.buyerDocument,
    originalKey: key, originalKitQuantity: 2, returnKitQuantity: 1, cfop: "1202",
    taxCodeKind: "CSOSN" as const, taxCode: "102", refundInCents: 1100
  };
  const returnXml = () => xml().replaceAll(key,returnKey)
    .replace("<tpNF>1</tpNF>", "<tpNF>0</tpNF>").replace("<finNFe>1</finNFe>", "<finNFe>4</finNFe>")
    .replace("<serie>2</serie>", "<serie>3</serie>").replace("<nNF>1</nNF>", "<nNF>2</nNF>")
    .replace("</ide>", `<NFref><refNFe>${key}</refNFe></NFref></ide>`)
    .replace("<qCom>2.0000</qCom>","<qCom>1.0000</qCom>").replaceAll("<vProd>20.00</vProd>","<vProd>10.00</vProd>")
    .replaceAll("<vFrete>2.00</vFrete>","<vFrete>1.00</vFrete>").replace("<vNF>22.00</vNF>","<vNF>11.00</vNF>")
    .replace("<CFOP>5102</CFOP>","<CFOP>1202</CFOP>");
  it("checks series, original invoice, partial pair quantities and the approved refund amount", () => {
    expect(readBlingAuthorizedResaleReturnXml(returnXml(),returnKey,xml(),returnExpected)).toMatchObject({
      key: returnKey, protocol: "000000000000001", totalInCents: 1100
    });
  });
  it.each([
    ["<cStat>100</cStat>","<cStat>204</cStat>"], ["<CFOP>1202</CFOP>","<CFOP>2202</CFOP>"],
    ["<nNF>2</nNF>","<nNF>3</nNF>"], ["<cProd>TEST-PAIR</cProd>","<cProd>OTHER-PAIR</cProd>"],
    [`<refNFe>${key}</refNFe>`,`<refNFe>${returnKey}</refNFe>`]
  ])("rejects a return whose fiscal evidence does not match %s",(from,to) => {
    expect(() => readBlingAuthorizedResaleReturnXml(returnXml().replace(from,to),returnKey,xml(),returnExpected)).toThrow();
  });
});
