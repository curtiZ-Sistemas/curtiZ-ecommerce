import { describe, expect, it } from "vitest";
import { localHelpReply } from "./help-intents";

describe("localHelpReply", () => {
  it.each(["Oi", "Olá", "Bom dia", "Boa tarde", "Boa noite"])(
    "responde à saudação %s sem depender da API",
    (message) => expect(localHelpReply(message)?.text).toContain("Como posso ajudar")
  );

  it("direciona rastreamento para pedidos", () => {
    expect(localHelpReply("Onde está meu pedido?")?.action?.href).toBe("/minha-conta/pedidos");
  });

  it("deixa dúvidas desconhecidas para a busca publicada", () => {
    expect(localHelpReply("Tenho uma dúvida muito específica")).toBeNull();
  });
});
