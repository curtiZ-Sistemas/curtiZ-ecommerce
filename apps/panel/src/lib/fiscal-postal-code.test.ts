import { describe, expect, it, vi } from "vitest";
import { lookupFiscalPostalCode, mergePostalAddress } from "./fiscal-postal-code";

describe("CEP da nota de atacado", () => {
  it("preenche rua, bairro, cidade e UF usando a mesma fonte do checkout", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      cep: "30110-100", logradouro: "Rua Teste", bairro: "Centro", localidade: "Belo Horizonte", uf: "MG"
    })));
    const signal = new AbortController().signal;
    expect(await lookupFiscalPostalCode("30110100", signal, transport)).toEqual({
      status: "found", address: { street: "Rua Teste", district: "Centro", city: "Belo Horizonte", state: "MG" }
    });
    expect(transport).toHaveBeenCalledWith("https://viacep.com.br/ws/30110100/json/", { signal, credentials: "omit", redirect: "error", cache: "no-store" });
  });
  it("aceita CEP geral de município sem inventar rua e bairro", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      cep: "35500-000", logradouro: "", bairro: "", localidade: "Divinópolis", uf: "MG"
    })));
    expect(await lookupFiscalPostalCode("35500000", new AbortController().signal, transport)).toEqual({
      status: "partial", address: { city: "Divinópolis", state: "MG" }
    });
  });
  it("não consulta CEP incompleto e não aceita resposta de outro CEP", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ cep: "00000-000", localidade: "Teste", uf: "MG" })));
    const signal = new AbortController().signal;
    expect(await lookupFiscalPostalCode("3011", signal, transport)).toEqual({ status: "missing" });
    expect(transport).not.toHaveBeenCalled();
    expect(await lookupFiscalPostalCode("30110100", signal, transport)).toEqual({ status: "failed" });
  });
  it("preserva alterações manuais e nunca preenche número ou complemento", () => {
    expect(mergePostalAddress({ street: "Rua corrigida", district: "", city: "", state: "", number: "10", complement: "Sala" },
      { street: "Rua anterior", district: "Centro", city: "Belo Horizonte", state: "MG" })).toEqual({
      street: "Rua corrigida", district: "Centro", city: "Belo Horizonte", state: "MG", number: "10", complement: "Sala"
    });
  });
});
