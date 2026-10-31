import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);

const state = vi.hoisted(() => ({ published: new Set<string>(), redirected: "" }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  redirect: (to: string) => { state.redirected = to; throw new Error("redirect"); }
}));
vi.mock("@/lib/seo", () => ({ BRAND_NAME: "curti Z", officialUrl: (path: string) => path }));
vi.mock("@/lib/storefront-data", () => ({ getPublicCmsPage: () => Promise.resolve(null) }));
vi.mock("@/lib/legal-data", () => ({
  getPublicLegalDocument: (slug: string) =>
    Promise.resolve({ document: state.published.has(slug) ? { slug } : null, unavailable: false })
}));
import ContentPage from "./page";

const open = (page: string) => ContentPage({ params: Promise.resolve({ page }) });
beforeEach(() => { state.published = new Set(); state.redirected = ""; });

describe("páginas antigas de políticas", () => {
  it.each([
    ["termos-de-uso", "/politicas/termos-de-uso"],
    ["politica-de-privacidade", "/politicas/aviso-de-privacidade"],
    ["formas-de-envio", "/politicas/entrega"],
    ["formas-de-pagamento", "/politicas/pagamento"]
  ])("%s abre a versão publicada no painel", async (page, destination) => {
    state.published.add(destination.replace("/politicas/", ""));
    await expect(open(page)).rejects.toThrow("redirect");
    expect(state.redirected).toBe(destination);
  });
  it("mantém o texto padrão enquanto a política não foi publicada", async () => {
    await expect(open("termos-de-uso")).resolves.toBeTruthy();
    expect(state.redirected).toBe("");
  });
  it("não redireciona páginas que não são políticas", async () => {
    state.published.add("sobre");
    await expect(open("sobre")).resolves.toBeTruthy();
    expect(state.redirected).toBe("");
  });
});
