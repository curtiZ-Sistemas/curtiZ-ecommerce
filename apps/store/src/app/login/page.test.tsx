import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth-form", () => ({ AuthForm: () => null }));
vi.mock("@/components/google-sign-in", () => ({ GoogleSignIn: () => null }));
vi.mock("@/lib/google-auth", () => ({ googleAuthReady: () => Promise.resolve(false) }));
import LoginPage from "./page";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("Google no formulário de login", () => {
  it.each([true, false])("repassa a disponibilidade (%s) ao formulário, sem bloco separado", async (google) => {
    state.google = google;
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(state.props).toMatchObject({ mode: "login", googleAvailable: google });
    expect(html).not.toContain("Acesso com Google");
  });
});

describe("mensagens ao retornar do painel", () => {
  it.each([
    ["google_oauth_error", "O acesso com Google foi cancelado, expirou ou não pôde ser concluído."],
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

const state = vi.hoisted(() => ({ google: false, props: undefined as Record<string, unknown> | undefined }));
vi.mock("@/components/auth-form", () => ({
  AuthForm: (props: Record<string, unknown>) => { state.props = props; return null; }
}));
vi.mock("@/lib/google-auth", () => ({ googleAuthReady: () => Promise.resolve(state.google) }));