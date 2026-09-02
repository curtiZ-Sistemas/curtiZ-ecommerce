import { describe, expect, it } from "vitest";
import {
  calculateSubtotal,
  calculateCommissionInCents,
  canTransitionRepresentativeApplication,
  canTransitionOrder,
  evaluatePromotion,
  initialSupportAssignment,
  roleHasPermission,
  wouldCreateReferralCycle
} from "./index";

describe("domínio Curtiz", () => {
  it("calcula subtotal apenas em centavos", () => {
    expect(calculateSubtotal([{ quantity: 2, unitPriceInCents: 5_990 }])).toBe(11_980);
  });

  it("bloqueia transição inválida de pedido", () => {
    expect(canTransitionOrder("pending_payment", "shipped")).toBe(false);
  });

  it("encaminha suporte novo ao Administrador", () => {
    expect(initialSupportAssignment.assignedRole).toBe("admin");
  });

  it("não permite financeiro completo ao operacional", () => {
    expect(roleHasPermission("operational", "financial.read_full")).toBe(false);
  });

  it("restringe a gestão do controle financeiro ao perfil gerencial", () => {
    expect(roleHasPermission("manager", "finance.manage")).toBe(true);
    expect(roleHasPermission("admin", "finance.manage")).toBe(false);
    expect(roleHasPermission("operational", "finance.manage")).toBe(false);
    expect(roleHasPermission("technical", "finance.manage")).toBe(false);
  });

  it("mantém a matriz de gestão de acessos sem escalada entre funções", () => {
    expect(roleHasPermission("manager", "users.access.manage_admin")).toBe(true);
    expect(roleHasPermission("manager", "users.access.manage_technical")).toBe(false);
    expect(roleHasPermission("technical", "users.access.manage_technical")).toBe(true);
    expect(roleHasPermission("technical", "users.access.manage_admin")).toBe(false);
    expect(roleHasPermission("admin", "users.access.manage_operator")).toBe(false);
  });

  it("limita desconto fixo ao subtotal", () => {
    expect(
      evaluatePromotion(
        { type: "fixed", amountInCents: 10_000 },
        { subtotalInCents: 5_000, quantity: 1, shippingInCents: 0 }
      )
    ).toBe(5_000);
  });

  it("calcula comissão em centavos por pontos-base", () => {
    expect(calculateCommissionInCents(19_990, { id: "regra", version: 2, basisPoints: 750 })).toBe(
      1_499
    );
  });

  it("protege o fluxo de análise da representante", () => {
    expect(canTransitionRepresentativeApplication("draft", "approved")).toBe(false);
    expect(canTransitionRepresentativeApplication("under_review", "approved")).toBe(true);
  });

  it("impede autorreferência e ciclos na rede", () => {
    const network = [
      { representativeId: "b", sponsorId: "a" },
      { representativeId: "c", sponsorId: "b" }
    ];
    expect(wouldCreateReferralCycle("a", "c", network)).toBe(true);
    expect(wouldCreateReferralCycle("d", "c", network)).toBe(false);
  });
});
