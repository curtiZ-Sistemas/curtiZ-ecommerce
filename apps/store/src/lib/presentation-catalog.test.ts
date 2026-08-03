import { describe, expect, it } from "vitest";
import { isPresentationCatalogEnabled } from "./presentation-catalog";

describe("isPresentationCatalogEnabled", () => {
  it("enables the presentation catalog in explicit demo mode", () => {
    expect(isPresentationCatalogEnabled({ DEMO_MODE: "true" })).toBe(true);
  });

  it("enables it when checkout is explicitly disabled", () => {
    expect(isPresentationCatalogEnabled({ CHECKOUT_ENABLED: "false" })).toBe(true);
  });

  it("does not infer presentation mode from missing configuration", () => {
    expect(isPresentationCatalogEnabled({})).toBe(false);
  });

  it("keeps the fallback disabled when checkout is active", () => {
    expect(
      isPresentationCatalogEnabled({ DEMO_MODE: "false", CHECKOUT_ENABLED: "true" })
    ).toBe(false);
  });
});
