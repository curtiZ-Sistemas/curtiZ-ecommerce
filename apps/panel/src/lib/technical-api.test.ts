import { describe, expect, it } from "vitest";
import { technicalDemoResourceRows } from "./technical-demo";

describe("technical demo resources", () => {
  it("não apresenta integrações externas como conectadas", () => {
    const rows = technicalDemoResourceRows("integracoes");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.state)).toEqual([
      "not_configured",
      "awaiting_credentials"
    ]);
    expect(rows.map((row) => row.metadata_sanitized)).toEqual([{ demo: true }, { demo: true }]);
  });

  it("não inventa registros técnicos nas demais áreas", () => {
    expect(technicalDemoResourceRows("logs")).toEqual([]);
  });
});
