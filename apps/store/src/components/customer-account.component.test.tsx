import { describe, expect, it } from "vitest";
import { customerStatusLabel } from "../lib/customer-account-presentation";

describe("customer account presentation", () => {
  it("uses clear pt-BR labels for commerce states", () => {
    expect(customerStatusLabel("pending_payment")).toBe("Aguardando pagamento");
    expect(customerStatusLabel("ready_to_ship")).toBe("Pronto para envio");
    expect(customerStatusLabel("return_requested")).toBe("Devolução solicitada");
  });

  it("keeps unknown provider states readable without inventing a status", () => {
    expect(customerStatusLabel("awaiting_provider")).toBe("awaiting provider");
  });
});
