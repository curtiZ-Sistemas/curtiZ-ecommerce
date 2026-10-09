import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth-form", () => ({ AuthForm: () => null }));
import LoginPage from "./page";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("mensagens ao retornar do painel", () => {
  it.each([
    ["session_expired", "Sua sessão não está disponível ou expirou."],
    ["session_unavailable", "Não foi possível confirmar sua sessão agora."]
  ])("explica %s sem alterar o formulário", async (reason, message) => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ reason }) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(message);
    expect(html).toContain("Acesse sua conta");
  });
  it("não apresenta conteúdo arbitrário da query como erro", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ reason: "sensitive-provider-error" }) }));
    expect(html).not.toContain("sensitive-provider-error");
    expect(html).not.toContain('role="alert"');
  });
});
