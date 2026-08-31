import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "nonce-seo" })
}));
vi.stubGlobal("React", React);

import { JsonLd } from "./json-ld";

describe("JSON-LD renderizado no servidor", () => {
  it("renderiza schema serializado com o nonce da CSP", async () => {
    const element = await JsonLd({
      data: { "@context": "https://schema.org", "@type": "Organization", name: "curti Z" }
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('nonce="nonce-seo"');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"name":"curti Z"');
  });
});
