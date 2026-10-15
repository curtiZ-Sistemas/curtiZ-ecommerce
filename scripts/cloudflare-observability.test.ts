import { describe, expect, it, vi } from "vitest";
import { protectWorkerQueryStrings } from "./cloudflare-observability";

const environment = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "fixture-token", DEPLOY_TARGET: "store" };
const reply = (result: unknown) => Response.json({ success: true, result });

describe("proteção de query strings após deploy", () => {
  it.each(["store", "panel"])("preserva logs e traces, sem alterar bindings do %s", async (target) => {
    const observability = { enabled: true, head_sampling_rate: 0.5, logs: { enabled: true },
      traces: { enabled: true, head_sampling_rate: 0.1 }, redact_query_string: false };
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ observability, logpush: false, tail_consumers: [] }))
      .mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(reply({ observability: { ...observability, redact_query_string: true } }));
    await protectWorkerQueryStrings({ ...environment, DEPLOY_TARGET: target }, transport);
    const [url, init] = transport.mock.calls[1]!;
    expect(url).toContain(`/workers/scripts/${target === "store" ? "curtiz-ecommerce" : "curtiz-painel"}/script-settings`);
    expect(init?.method).toBe("PATCH");
    if (typeof init?.body !== "string") throw new Error("JSON body expected");
    expect(JSON.parse(init.body)).toEqual({ observability: { ...observability, redact_query_string: true } });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("não escreve quando a proteção já está ativa", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply({ observability: { redact_query_string: true } }));
    await protectWorkerQueryStrings(environment, transport);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("falha se a API não persistir a proteção", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => reply({ observability: { redact_query_string: false } }));
    await expect(protectWorkerQueryStrings(environment, transport)).rejects.toThrow("não foi confirmada");
  });

  it("não expõe mensagens do provedor nem repete falha de escrita", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ observability: { redact_query_string: false } }))
      .mockResolvedValueOnce(Response.json({ success: false, errors: [{ message: "private-provider-detail" }] }, { status: 403 }));
    await expect(protectWorkerQueryStrings(environment, transport)).rejects.toThrow("Não foi possível configurar");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([{ DEPLOY_TARGET: "other" }, { CLOUDFLARE_ACCOUNT_ID: "../other" }, { CLOUDFLARE_API_TOKEN: "" }])(
    "recusa configuração inválida antes da rede: %j", async (invalid) => {
      const transport = vi.fn<typeof fetch>();
      await expect(protectWorkerQueryStrings({ ...environment, ...invalid }, transport)).rejects.toThrow("inválida");
      expect(transport).not.toHaveBeenCalled();
    });
});
