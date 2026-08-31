import { afterEach, describe, expect, it } from "vitest";
import { configuredPublicOrigins, resolvePublicAppUrls } from "./public-urls";

const previous = {
  store: process.env.NEXT_PUBLIC_STORE_URL,
  panel: process.env.NEXT_PUBLIC_PANEL_URL,
  storeTest: process.env.NEXT_PUBLIC_STORE_TEST_URL,
  panelTest: process.env.NEXT_PUBLIC_PANEL_TEST_URL
};

afterEach(() => {
  process.env.NEXT_PUBLIC_STORE_URL = previous.store;
  process.env.NEXT_PUBLIC_PANEL_URL = previous.panel;
  process.env.NEXT_PUBLIC_STORE_TEST_URL = previous.storeTest;
  process.env.NEXT_PUBLIC_PANEL_TEST_URL = previous.panelTest;
});

describe("URLs públicas das aplicações", () => {
  it("mantém o par canônico no domínio oficial", () => {
    process.env.NEXT_PUBLIC_STORE_URL = "https://curtiz.com.br";
    process.env.NEXT_PUBLIC_PANEL_URL = "https://painel.curtiz.com.br";

    expect(resolvePublicAppUrls("https://curtiz.com.br/produtos")).toEqual({
      storeUrl: "https://curtiz.com.br",
      panelUrl: "https://painel.curtiz.com.br"
    });
  });

  it("seleciona o par de teste quando a requisição vem do workers.dev", () => {
    process.env.NEXT_PUBLIC_STORE_URL = "https://curtiz.com.br";
    process.env.NEXT_PUBLIC_PANEL_URL = "https://painel.curtiz.com.br";
    process.env.NEXT_PUBLIC_STORE_TEST_URL =
      "https://curtiz-ecommerce.sistemas-curtiz.workers.dev";
    process.env.NEXT_PUBLIC_PANEL_TEST_URL = "https://curtiz-panel.sistemas-curtiz.workers.dev";

    expect(
      resolvePublicAppUrls("https://curtiz-ecommerce.sistemas-curtiz.workers.dev/login")
    ).toEqual({
      storeUrl: "https://curtiz-ecommerce.sistemas-curtiz.workers.dev",
      panelUrl: "https://curtiz-panel.sistemas-curtiz.workers.dev"
    });
    expect(configuredPublicOrigins()).toHaveLength(4);
  });

  it("preserva o par de portas do desenvolvimento local", () => {
    expect(resolvePublicAppUrls("http://127.0.0.1:3001/administracao")).toEqual({
      storeUrl: "http://127.0.0.1:3000",
      panelUrl: "http://127.0.0.1:3001"
    });
  });
});
