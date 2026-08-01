import { describe, expect, it } from "vitest";
import { isMockRuntimeAllowed, MockShippingProvider } from "./index";

describe("runtime de providers mock", () => {
  it("permite build otimizado de staging sem confundir NODE_ENV com ambiente comercial", () => {
    expect(isMockRuntimeAllowed({ NODE_ENV: "production", APP_ENV: "staging" })).toBe(true);
  });

  it("bloqueia mocks no ambiente comercial de produção", () => {
    expect(isMockRuntimeAllowed({ NODE_ENV: "production", APP_ENV: "production" })).toBe(false);
  });

  it("expõe estado honesto quando o mock não é permitido", async () => {
    const previous = { app: process.env.APP_ENV, node: process.env.NODE_ENV };
    process.env.APP_ENV = "production";
    process.env.NODE_ENV = "production";
    await expect(new MockShippingProvider().health()).resolves.toBe("not_configured");
    process.env.APP_ENV = previous.app;
    process.env.NODE_ENV = previous.node;
  });
});

