import { describe, expect, it } from "vitest";
import { isPresentationCatalogEnabled } from "./presentation-catalog";

describe("isPresentationCatalogEnabled", () => {
  it("enables the presentation catalog in explicit demo mode", () => {
    expect(isPresentationCatalogEnabled({ DEMO_MODE: "true" })).toBe(true);
  });

  it("does not enable demo data merely because checkout is disabled", () => {
    expect(isPresentationCatalogEnabled({ CHECKOUT_ENABLED: "false" })).toBe(false);
  });

  it("keeps presentation data disabled when configuration is missing", () => {
    expect(isPresentationCatalogEnabled({})).toBe(false);
  });

  it("keeps the fallback disabled when checkout is active", () => {
    expect(
      isPresentationCatalogEnabled({ DEMO_MODE: "false", CHECKOUT_ENABLED: "true" })
    ).toBe(false);
  });
});
