import { describe, expect, it } from "vitest";
import type { CartLine } from "@curtiz/domain";
import { applyCartAvailability, retainCartLines, unavailableRetentionMs } from "./cart-availability";
const line: CartLine = { productId: "p", variantId: "v", name: "Produto", image: "/icon.svg", color: "Preto", size: "37", quantity: 1, unitPriceInCents: 1000 };
describe("produtos removidos no carrinho", () => {
  it("não considera ausência de resposta como exclusão", () => {
    expect(applyCartAvailability([line], [])).toEqual([line]);
  });
  it("usa a data do servidor mesmo se o visitante voltar dias depois", () => {
    expect(applyCartAvailability([line], [{ variantId: "v", available: false, unavailableAt: new Date(1000).toISOString() }], 1000 + unavailableRetentionMs)).toEqual([]);
  });
  it("preserva o primeiro prazo, expira em 72 horas e mantém os demais itens", () => {
    const removed = applyCartAvailability([line], [{ variantId: "v", available: false }], 1000);
    expect(removed[0]?.unavailableAt).toBe(new Date(1000).toISOString());
    expect(applyCartAvailability(removed, [{ variantId: "v", available: false }], 2000)).toEqual(removed);
    expect(retainCartLines([...removed, { ...line, variantId: "other" }], 1000 + unavailableRetentionMs)).toEqual([{ ...line, variantId: "other" }]);
    expect(retainCartLines(removed, 999 + unavailableRetentionMs)).toHaveLength(1);
  });
});
