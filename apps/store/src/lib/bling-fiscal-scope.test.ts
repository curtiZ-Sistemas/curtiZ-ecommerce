import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertBlingB2CRecipient } from "./bling-fiscal-scope";

describe("homologated B2C execution scope", () => {
  it.each([{}, { documentType: "CNPJ" }, { representative: true }])(
    "uses the explicit tax declaration, independently of document or role: %j", extra => {
      expect(() => assertBlingB2CRecipient({ ...extra, icms_taxpayer: false, final_consumer: true })).not.toThrow();
    });
  it.each([[true, true], [true, false], [false, false]])(
    "holds taxpayer=%s finalConsumer=%s until its own homologation", (icms_taxpayer, final_consumer) => {
      expect(() => assertBlingB2CRecipient({ icms_taxpayer, final_consumer })).toThrow("fiscal_scenario_not_homologated");
    });
  it.each([{}, { icms_taxpayer: false }, { icms_taxpayer: "false", final_consumer: true }])(
    "does not invent a missing declaration: %j", recipient => {
      expect(() => assertBlingB2CRecipient(recipient)).toThrow("fiscal_recipient_required");
    });
});
