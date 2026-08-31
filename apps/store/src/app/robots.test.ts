import { describe, expect, it } from "vitest";
import { buildRobots } from "./robots";

describe("robots da loja", () => {
  it("libera a loja oficial, aponta o sitemap oficial e protege rotas privadas", () => {
    const result = buildRobots("curtiz.com.br");
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(result.sitemap).toBe("https://curtiz.com.br/sitemap.xml");
    expect(rule).toMatchObject({ userAgent: "*", allow: "/" });
    expect(rule?.disallow).toEqual(
      expect.arrayContaining(["/api/", "/checkout", "/minha-conta", "/representante/"])
    );
  });

  it("bloqueia integralmente aliases workers.dev", () => {
    expect(buildRobots("curtiz-store.example.workers.dev")).toEqual({
      rules: [{ userAgent: "*", disallow: "/" }]
    });
  });
});
