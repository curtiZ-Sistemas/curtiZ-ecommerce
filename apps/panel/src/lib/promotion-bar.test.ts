import { describe, expect, it } from "vitest";
import { promotionBarMutationSchema, promotionBarReorderSchema } from "./promotion-bar";

const validMessage = {
  text: "Confira as condições da campanha",
  active: true,
  sortOrder: 0,
  href: "/ofertas",
  cta: "Ver ofertas",
  startsAt: null,
  endsAt: null
};

describe("validação administrativa da barra promocional", () => {
  it("aceita texto simples e link interno", () => {
    expect(promotionBarMutationSchema.safeParse(validMessage).success).toBe(true);
  });

  it("recusa HTML, link externo e período invertido", () => {
    expect(
      promotionBarMutationSchema.safeParse({ ...validMessage, text: "<strong>Oferta</strong>" })
        .success
    ).toBe(false);
    expect(
      promotionBarMutationSchema.safeParse({ ...validMessage, href: "https://example.com" }).success
    ).toBe(false);
    expect(
      promotionBarMutationSchema.safeParse({
        ...validMessage,
        startsAt: "2026-08-24T00:00:00.000Z",
        endsAt: "2026-08-23T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("não aceita CTA sem destino nem IDs duplicados na ordenação", () => {
    expect(promotionBarMutationSchema.safeParse({ ...validMessage, href: null }).success).toBe(false);
    const id = "84f06000-9108-4d19-9f64-6a03086158eb";
    expect(promotionBarReorderSchema.safeParse({ action: "reorder", ids: [id, id] }).success).toBe(
      false
    );
  });
});
