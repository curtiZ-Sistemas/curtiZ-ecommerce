import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scanAttachment } from "./index";

const bytes = new Uint8Array([1,2,3]);
const input = { bytes, mimeType: "application/pdf", expectedSha256: createHash("sha256").update(bytes).digest("hex") };
describe("attachment quarantine verdicts", () => {
  it.each(["pending","unknown","failed",null,{},true])("does not accept ambiguous verdict %s as clean", async (verdict) => {
    expect(await scanAttachment({ ...input, scanner: { scan: async () => ({ verdict }) } })).toBe("failed");
  });
  it.each(["clean","infected","suspicious"] as const)("preserves explicit %s", async (verdict) => {
    expect(await scanAttachment({ ...input, scanner: { scan: async () => ({ verdict }) } })).toBe(verdict);
  });
  it("fails closed without a provider or on failure", async () => {
    expect(await scanAttachment(input)).toBe("failed");
    expect(await scanAttachment({ ...input, scanner: { scan: async () => { throw new Error("unavailable"); } } })).toBe("failed");
    expect(await scanAttachment({ ...input, expectedSha256: "0".repeat(64), scanner: { scan: async () => ({ verdict: "clean" }) } })).toBe("suspicious");
  });
});
