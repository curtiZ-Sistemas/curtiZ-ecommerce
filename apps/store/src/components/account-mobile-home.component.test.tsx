import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { emptyCustomerAccount } from "../lib/customer-account-types";
import {
  AccountMobileHome,
  AccountMobileSubpageHeader
} from "./account-mobile-home";

vi.mock("./logout-button", () => ({
  LogoutButton: () => "Sair da conta"
}));
vi.mock("./user-avatar", () => ({
  UserAvatar: () => "Cliente Demo"
}));

const snapshot = () => ({
  ...emptyCustomerAccount({
    fullName: "Cliente Demo",
    email: "cliente.demo@curtiz.local"
  }),
  authenticated: true
});

describe("AccountMobileHome", () => {
  it("exibe a central vertical com dados reais e o fluxo de candidatura", () => {
    const html = renderToStaticMarkup(
      <AccountMobileHome snapshot={snapshot()} favoriteCount={2} />
    );

    expect(html).toContain("Olá, Cliente");
    expect(html).toContain("cliente.demo@curtiz.local");
    expect(html).toContain("2 produtos salvos");
    expect(html).toContain("Seja um representante");
    expect(html).toContain("Conheça o programa de representantes");
    expect(html).toContain('href="/representante/solicitacao"');
    expect(html).toContain('href="/minha-conta/pedidos"');
    expect(html).toContain("Sair da conta");
  });

  it("mostra somente o rótulo aprovado e preserva a conta de cliente", () => {
    const approved = snapshot();
    approved.representative = {
      ...approved.representative,
      representativeStatus: "active",
      approved: true
    };
    const html = renderToStaticMarkup(
      <AccountMobileHome snapshot={approved} favoriteCount={0} />
    );

    expect(html).toContain("Painel do representante");
    expect(html).toContain('href="/representante"');
    expect(html).not.toContain("Painel da representante");
    expect(html).not.toContain("Portal do representante");
    expect(html).toContain('href="/minha-conta/perfil"');
  });

  it("oferece retorno real para a central nas páginas internas", () => {
    const html = renderToStaticMarkup(
      <AccountMobileSubpageHeader section="pedidos" />
    );

    expect(html).toContain('href="/minha-conta"');
    expect(html).toContain("Voltar");
    expect(html).toContain("Pedidos");
  });
});
