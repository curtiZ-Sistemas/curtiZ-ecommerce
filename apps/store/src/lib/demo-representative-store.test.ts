import { describe, expect, it } from "vitest";
import {
  getDemoRepresentativeSnapshot,
  recordDemoRepresentativeSale,
  saveDemoRepresentativeDraft,
  submitDemoRepresentativeApplication
} from "./demo-representative-store";

describe("fluxo demo de representante", () => {
  it("salva rascunho, exige termos e envia a solicitação", () => {
    const actor = { email: "nova.representante@curtiz.local", fullName: "Nova Representante" };
    saveDemoRepresentativeDraft(actor, 1, { cpfLastFour: "1234" });
    saveDemoRepresentativeDraft(actor, 5, { termsAccepted: true });
    expect(submitDemoRepresentativeApplication(actor.email).status).toBe("submitted");
  });

  it("registra venda apenas para representante ativa", () => {
    const items = [{ variantId: "10000000-0000-4000-8000-000000000001", quantity: 2 }];
    const sale = recordDemoRepresentativeSale(
      "representante.demo@curtiz.local",
      items,
      "00000000-0000-4000-8000-000000000100"
    );
    const retry = recordDemoRepresentativeSale(
      "representante.demo@curtiz.local",
      items,
      "00000000-0000-4000-8000-000000000100"
    );
    expect(sale).toMatchObject({ totalInCents: 11_980, status: "confirmed" });
    expect(retry.id).toBe(sale.id);
    expect(getDemoRepresentativeSnapshot("representante.demo@curtiz.local").sales).toContainEqual(
      sale
    );
    expect(
      getDemoRepresentativeSnapshot("representante.demo@curtiz.local").inventory[0]?.quantity
    ).toBe(4);
  });
});
