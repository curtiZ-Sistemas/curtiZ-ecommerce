import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_TERMS_REQUIRED_MESSAGE, GoogleSignIn, startGoogleSignIn } from "./google-sign-in";
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

describe("startGoogleSignIn", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does not call the server without the terms", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await startGoogleSignIn({ terms: false, remember: true })).toEqual({
      ok: false,
      message: GOOGLE_TERMS_REQUIRED_MESSAGE
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only consent, persistence and the return path, never credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ redirectTo: "https://accounts.example.invalid/authorize" })
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await startGoogleSignIn({ terms: true, remember: true, returnTo: "/minha-conta" });
    expect(result).toEqual({ ok: true, redirectTo: "https://accounts.example.invalid/authorize", alreadyAuthenticated: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/auth/google");
    expect(JSON.parse(init.body)).toEqual({ terms: true, marketing: false, remember: true, next: "/minha-conta" });
  });
  it("reports server refusal and network failure without a redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ message: "Origem não permitida." }) }));
    expect(await startGoogleSignIn({ terms: true, remember: false })).toEqual({ ok: false, message: "Origem não permitida." });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await startGoogleSignIn({ terms: true, remember: false })).ok).toBe(false);
  });
});
