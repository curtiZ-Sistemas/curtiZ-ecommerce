import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/personal-data", () => import("../lib/personal-data"));
vi.mock("@/lib/session-persistence-client", () => ({ setClientAuthPersistence: vi.fn() }));
vi.mock("@/lib/signup-validation", () => import("../lib/signup-validation"));
vi.mock("./turnstile-field", () => ({ TurnstileField: () => null }));
import { AuthForm } from "./auth-form";
import { SignupForm } from "./signup-form";
vi.stubGlobal("React", React);

describe("submissão antes da hidratação", () => {
  it("cadastro atual mantém POST e envio desabilitado no HTML inicial", () => {
    const html = renderToStaticMarkup(<SignupForm />);
    expect(html).toMatch(/<form[^>]*method="post"/u);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });
  it.each(["login", "signup"] as const)("%s não habilita o envio nativo de credenciais por GET", (mode) => {
    const html = renderToStaticMarkup(<AuthForm mode={mode} />);
    expect(html).toMatch(/<form[^>]*method="post"/u);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });
});
