import { afterEach, describe, expect, it, vi } from "vitest";
import { melhorEnvioConfigurationIssues, melhorEnvioEnvironment, panelMelhorEnvioProvider } from "./melhor-envio-server";

vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ createServiceSupabaseClient: () => null }));

describe("configuração Melhor Envio do Worker do painel", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("ambiente inválido falha antes de abrir o cofre OAuth", () => {
    vi.stubEnv("MELHOR_ENVIO_ENVIRONMENT", "prodution");
    expect(() => melhorEnvioEnvironment()).toThrow(expect.objectContaining({ code: "configuration", httpStatus: 503 }));
    expect(() => panelMelhorEnvioProvider()).toThrow(expect.objectContaining({ code: "configuration", httpStatus: 503 }));
  });
  it.each(["sandbox", "production"])("mantém o ambiente explícito %s", selected => {
    vi.stubEnv("MELHOR_ENVIO_ENVIRONMENT", selected);
    expect(melhorEnvioEnvironment()).toBe(selected);
  });
  it("lista somente nomes de campos ausentes ou inválidos, nunca valores", () => {
    const issues = melhorEnvioConfigurationIssues({
      SHIPPING_PROVIDER: "melhorenvio",
      MELHOR_ENVIO_ENABLED: "true",
      MELHOR_ENVIO_ENVIRONMENT: "sandbox",
      MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br/api/v2",
      MELHOR_ENVIO_CLIENT_SECRET: "segredo-do-painel",
      MELHOR_ENVIO_ORIGIN_DOCUMENT: "12345678000190"
    });
    expect(issues).toContain("inválido: MELHOR_ENVIO_BASE_URL_INVALID");
    expect(issues).toContain("ausente: MELHOR_ENVIO_CLIENT_ID");
    expect(issues).toContain("inválido: MELHOR_ENVIO_ORIGIN_DOCUMENT_INVALID");
    expect(issues).not.toContain("segredo-do-painel");
    expect(issues).not.toContain("12345678000190");
  });
});
