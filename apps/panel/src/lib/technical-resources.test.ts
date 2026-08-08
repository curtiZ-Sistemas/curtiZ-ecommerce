import { describe, expect, it } from "vitest";
import { isTechnicalResource, technicalResourceKeys, technicalResources } from "./technical-resources";

describe("technical resources", () => {
  it("mantém uma lista fechada de recursos exclusivamente técnicos", () => {
    expect(technicalResourceKeys).toContain("logs");
    expect(technicalResourceKeys).toContain("webhooks");
    expect(isTechnicalResource("feature-flags")).toBe(true);
    expect(isTechnicalResource("financeiro")).toBe(false);
    expect(isTechnicalResource("produtos")).toBe(false);
    expect(isTechnicalResource("comissoes")).toBe(false);
  });

  it("pagina logs e não seleciona segredos ou payload bruto", () => {
    for (const resource of Object.values(technicalResources)) {
      expect(resource.select).not.toMatch(/secret|access_token|raw_payload|idempotency_key/i);
      expect(resource.columns.length).toBeGreaterThan(0);
    }
    expect(technicalResources.logs.searchColumns).toEqual(expect.arrayContaining(["message", "source", "event_type"]));
    expect(technicalResources.logs.exportAllowed).toBe(true);
  });
});
