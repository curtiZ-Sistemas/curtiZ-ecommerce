import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepresentativeKitCardPayment } from "./representative-kit-card-payment";
import { readGradeCatalog, RepresentativeKitGrades } from "./representative-kit-grades";
import { isPrepayMethod, prepayMethods, RepresentativeKitOrderHistory } from "./representative-kit-order";
import { KitRequestError, kitRequest } from "./representative-kit-request";

const orderId = "10000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("kit card payment form", () => {
  it("renders a container for the Mercado Pago Brick and never any card field of its own", () => {
    const markup = renderToStaticMarkup(<RepresentativeKitCardPayment orderId={orderId} kind="credit" onResult={() => undefined} />);
    expect(markup).toContain(`id="kit-card-brick-${orderId}"`);
    expect(markup).toContain("Cartão de crédito");
    expect(markup).not.toMatch(/<input|cardNumber|card_number|cvv|security/iu);
    expect(renderToStaticMarkup(<RepresentativeKitCardPayment orderId={orderId} kind="debit" onResult={() => undefined} />))
      .toContain("Cartão de débito");
  });
});

describe("kit prepay choice", () => {
  it("offers Pix, credit and debit and rejects anything else", () => {
    expect(Object.values(prepayMethods)).toEqual(["Pix", "Cartão de crédito", "Cartão de débito"]);
    expect(["pix", "credit_card", "debit_card"].every(isPrepayMethod)).toBe(true);
    expect(["cash", "boleto", "", "__proto__"].some(isPrepayMethod)).toBe(false);
  });
});

describe("kit orders panel", () => {
  it("keeps the orders in a closed panel, so the offers are never pushed down", () => {
    const markup = renderToStaticMarkup(<RepresentativeKitOrderHistory checkoutConfigured onOffersChanged={() => undefined} />);
    expect(markup).toContain(">Meus pedidos de kits</button>");
    expect(markup).toContain("<dialog");
    expect(markup).not.toMatch(/<dialog[^>]* open/u);
    expect(markup).not.toContain("Gerar Pix");
  });
});

describe("kit request errors", () => {
  it("keeps the fixed code of a specific refusal and its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({
      code: "PAYER_DOCUMENT_REQUIRED", message: "Complete seu CPF ou CNPJ no cadastro para pagar com Pix ou cartão." }) }));
    const failure = await kitRequest({ action: "pix", orderId }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KitRequestError);
    expect(failure).toMatchObject({ code: "PAYER_DOCUMENT_REQUIRED" });
    expect((failure as Error).message).toMatch(/CPF ou CNPJ/u);
  });

  it("has no code for a generic refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Não foi possível concluir a operação do kit." }) }));
    expect(await kitRequest({ action: "pix", orderId }).catch((error: unknown) => error)).toMatchObject({ code: "" });
  });
});

describe("kit offers", () => {
  it("never shows the kit color", () => {
    const catalog = readGradeCatalog({ items: [{ kitId: orderId, name: "Kit Teste", color: "Vermelho", description: "",
      templates: [{ code: "standard", label: "Ficha padrão", available: 10, unitPriceInCents: 12000, sizes: [{ size: "37", pairs: 2 }] }] }] });
    const markup = renderToStaticMarkup(<RepresentativeKitGrades offers={catalog.offers} />);
    expect(markup).toContain("Kit Teste");
    expect(markup).not.toContain("Vermelho");
  });
});
