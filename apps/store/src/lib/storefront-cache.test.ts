import { describe, expect, it } from "vitest";
import { storefrontFreshnessHeaders } from "./storefront-cache";

describe("atualização do catálogo no edge", () => {
  it("obriga revalidação após toda alteração na fonte de verdade", () => {
    expect(storefrontFreshnessHeaders["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate"
    );
    expect(storefrontFreshnessHeaders["cache-control"]).not.toContain("stale-while-revalidate");
  });
});
