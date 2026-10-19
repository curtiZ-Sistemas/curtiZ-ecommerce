import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GoogleSignIn } from "./google-sign-in";
vi.stubGlobal("React", React);
describe("Google sign in", () => {
  it("keeps the provider disabled before hydration or configuration, without a native credential submission", () => {
    const html = renderToStaticMarkup(<GoogleSignIn available={false} />);
    expect(html).toContain("Continuar com Google");
    expect(html).toContain('disabled=""');
    expect(html).toContain('method="post"');
    expect(html).toContain("indisponível no momento");
    expect(html).not.toContain('type="password"');
  });
  it("requires explicit terms and keeps marketing separate and unchecked", () => {
    const html = renderToStaticMarkup(<GoogleSignIn available signup />);
    expect(html).toMatch(/<input(?=[^>]*name="terms")(?=[^>]*required)[^>]*>/u);
    expect(html).toContain('name="marketing"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("Termos de Uso");
    expect(html).toContain("Política de Privacidade");
  });
});
