import { beforeEach, describe, expect, it, vi } from "vitest";

const readAuthorizedReturnXml = vi.hoisted(() => vi.fn(() => ({ key: "verified", protocol: "100000000000001", fiscalLines: [] })));
vi.mock("server-only", () => ({}));
vi.mock("@curtiz/integrations", () => ({
  BlingError: class BlingError extends Error {}, readBlingAuthorizedResaleReturnXml: readAuthorizedReturnXml
}));
vi.mock("@curtiz/security", () => ({ logServerEvent: vi.fn() }));
vi.mock("./representative-test-transactions", () => ({ kitCall: vi.fn() }));
vi.mock("./unknown-data", () => ({
  isUnknownRecord: (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value),
  readNumber: (row: Record<string, unknown>, key: string) => typeof row[key] === "number" ? row[key] : 0,
  readRows: (value: unknown) => Array.isArray(value) ? value : [],
  readString: (row: Record<string, unknown>, key: string) => typeof row[key] === "string" ? row[key] : ""
}));

import type { BlingClient } from "@curtiz/integrations";
import { verifyRepresentativeKitReturnInvoice } from "./representative-commercial-returns";

const key = "31" + "1".repeat(42);
const originalKey = "31" + "2".repeat(42);
const originalXml = new TextEncoder().encode("fixture original XML").buffer;
const returnedXml = new TextEncoder().encode("fixture return XML").buffer;
const digest = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

function provider(series: number, natureId: number) {
  return {
    request: vi.fn(async (path: string) => ({ data: path === "/nfe/12"
      ? { id: 12, chaveAcesso: key, situacao: 5, serie: series, naturezaOperacao: { id: natureId } }
      : { id: 13, chaveAcesso: originalKey, situacao: 5 } })),
    invoiceDocument: vi.fn(async (accessKey: string) => accessKey === key ? returnedXml : originalXml)
  } as unknown as BlingClient;
}

async function job() {
  return {
    invoiceId: 12, originalInvoiceId: 13, invoiceKey: key, originalKey, originalHash: await digest(originalXml),
    documentOrigin: "own_inflow", issuerDocument: "68267385000191", buyerDocument: "11222333000181",
    originalQuantity: 1, returnQuantity: 1, fiscalTotalInCents: 1000,
    returnRule: { series: 4, external_nature_id: 15111772281, cfop: "1202", taxCodeKind: "CSOSN", taxCode: "102" }
  };
}

describe("representative kit return fiscal verification", () => {
  beforeEach(() => readAuthorizedReturnXml.mockClear());

  it("rejects a return note issued in the sale series", async () => {
    await expect(verifyRepresentativeKitReturnInvoice(provider(3, 15111772281), await job())).rejects.toThrow();
    expect(readAuthorizedReturnXml).not.toHaveBeenCalled();
  });

  it("rejects an authorized note with the wrong Bling nature", async () => {
    await expect(verifyRepresentativeKitReturnInvoice(provider(4, 15111725693), await job())).rejects.toThrow();
    expect(readAuthorizedReturnXml).not.toHaveBeenCalled();
  });

  it("accepts only the configured series 004 nature after XML authorization is checked", async () => {
    const result = await verifyRepresentativeKitReturnInvoice(provider(4, 15111772281), await job());
    expect(result.protocol).toBe("100000000000001");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(readAuthorizedReturnXml).toHaveBeenCalledWith(expect.any(String), key, expect.any(String),
      expect.objectContaining({ origin: "own_inflow", cfop: "1202", taxCode: "102" }));
  });
});
