import { describe, expect, it } from "vitest";
import {
  cancelDemoRepresentativeSale,
  createDemoKitOrder,
  getDemoRepresentativeSnapshot,
  markDemoRepresentativeNotification,
  recordDemoRepresentativeSale,
  saveDemoRepresentativeDraft,
  submitDemoRepresentativeApplication,
  updateDemoRepresentativeProfile
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

  it("estorna o estoque ao cancelar uma venda demonstrativa", () => {
    const email = "representante.demo@curtiz.local";
    const before = getDemoRepresentativeSnapshot(email).inventory[0]?.quantity ?? 0;
    const sale = recordDemoRepresentativeSale(
      email,
      [{ variantId: "10000000-0000-4000-8000-000000000001", quantity: 1 }],
      "00000000-0000-4000-8000-000000000101"
    );
    expect(getDemoRepresentativeSnapshot(email).inventory[0]?.quantity).toBe(before - 1);
    expect(cancelDemoRepresentativeSale(email, sale.id).status).toBe("cancelled");
    expect(getDemoRepresentativeSnapshot(email).inventory[0]?.quantity).toBe(before);
  });

  it("mantém perfil, kit e notificações no escopo da representante demo", () => {
    const email = "representante.demo@curtiz.local";
    expect(updateDemoRepresentativeProfile(email, "RJ").regionCode).toBe("RJ");
    const order = createDemoKitOrder(
      email,
      "20000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000102"
    );
    expect(order).toMatchObject({ status: "paid", totalInCents: 19_990 });
    expect(markDemoRepresentativeNotification(email, "notification-demo-1").readAt).toBeTruthy();
  });
});
