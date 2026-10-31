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
    for (const id of ["signup-name", "signup-email", "signup-phone", "signup-password", "signup-confirm"]) {
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"[^>]*disabled=""`, "u"));
    }
  });
  it.each(["login", "signup"] as const)("%s não habilita o envio nativo de credenciais por GET", (mode) => {
    const html = renderToStaticMarkup(<AuthForm mode={mode} />);
    expect(html).toMatch(/<form[^>]*method="post"/u);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/u);
  });
});

describe("login com e-mail e Google no mesmo formulário", () => {
  const login = (googleAvailable: boolean) => renderToStaticMarkup(<AuthForm mode="login" googleAvailable={googleAvailable} />);
  it("ordena lembrar, termos, Entrar e Google", () => {
    const html = login(true);
    const order = ["name=\"remember\"", "name=\"terms\"", ">Entrar<", "Continuar com Google"].map((item) => html.indexOf(item));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("exige os termos, mantém uma única caixa de lembrar e chama o botão só de Entrar", () => {
    const html = login(true);
    expect(html).toMatch(/<input(?=[^>]*name="terms")(?=[^>]*required)[^>]*>/u);
    expect(html.match(/name="remember"/gu)).toHaveLength(1);
    expect(html).not.toContain("Entrar na minha conta");
    expect(html).toContain("Termos de Uso");
    expect(html).toContain("Política de Privacidade");
  });
  it("o botão do Google não envia o formulário de senha", () => {
    const html = login(true);
    expect(html).toMatch(/<button[^>]*class="google-sign-in-button"[^>]*type="button"|<button[^>]*type="button"[^>]*class="google-sign-in-button"/u);
    expect(html.match(/type="submit"/gu)).toHaveLength(1);
  });
  it("mostra o Google desabilitado e a explicação quando indisponível", () => {
    const html = login(false);
    expect(html).toContain("Login com Google indisponível no momento");
    expect(html).toMatch(/<button[^>]*google-sign-in-button[^>]*disabled=""/u);
  });
  it("o cadastro não ganha o Google nem o texto Entrar", () => {
    const html = renderToStaticMarkup(<AuthForm mode="signup" googleAvailable />);
    expect(html).not.toContain("Continuar com Google");
    expect(html).toContain("Criar minha conta");
  });
});
