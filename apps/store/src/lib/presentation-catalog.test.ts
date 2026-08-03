import { describe, expect, it } from "vitest";
import { isPresentationCatalogEnabled } from "./presentation-catalog";

describe("isPresentationCatalogEnabled", () => {
  it("enables the presentation catalog in explicit demo mode", () => {
    expect(isPresentationCatalogEnabled({ DEMO_MODE: "true" })).toBe(true);
  });

  it("enables it when checkout is explicitly disabled", () => {
    expect(isPresentationCatalogEnabled({ CHECKOUT_ENABLED: "false" })).toBe(true);
  });

  it("uses the safe disabled-checkout default when configuration is missing", () => {
    expect(isPresentationCatalogEnabled({})).toBe(true);
  });

  it("keeps the fallback disabled when checkout is active", () => {
    expect(
      isPresentationCatalogEnabled({ DEMO_MODE: "false", CHECKOUT_ENABLED: "true" })
    ).toBe(false);
  });
});
