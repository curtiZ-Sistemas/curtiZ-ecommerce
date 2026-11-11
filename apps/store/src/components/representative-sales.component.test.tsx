import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaleForm, Sales } from "./representative-portal";

vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/lib/unknown-data", () => import("../lib/unknown-data"));
vi.mock("@/lib/representative-attempt", () => import("../lib/representative-attempt"));

describe("representative sale history", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders a sale without a date and shows its saved payment details", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<Sales sales={[{
      id: "sale-a", publicCode: "VD-TEST", totalInCents: 5000,
      status: "confirmed", soldAt: "", paymentMethod: "pix", notes: "Nota de teste"
    }]} />);
    expect(html).toContain("Data não informada");
    expect(html).toContain("Pagamento: ");
    expect(html).toContain("Pix");
    expect(html).toContain("Nota de teste");
  });

  it("keeps a valid sale date visible in the history", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<Sales sales={[{
      id: "sale-b", publicCode: "VD-VALID", totalInCents: 1000,
      status: "confirmed", soldAt: "2026-11-01T12:00:00.000Z"
    }]} />);
    expect(html).toContain("01/11/2026");
  });

  it("warns when the visible history may be incomplete", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<Sales sales={[{
      id: "sale-c", publicCode: "VD-PARTIAL", totalInCents: 1000,
      status: "confirmed", soldAt: "2026-11-01T12:00:00.000Z"
    }]} countUnavailable onRefresh={() => undefined} />);
    expect(html).toContain("VD-PARTIAL");
    expect(html).toContain("registros exibidos podem estar incompletos");
    expect(html).toContain("Tentar novamente");
  });

  it("does not show stale sales while a new filter is loading", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<Sales sales={[{
      id: "sale-d", publicCode: "VD-STALE", totalInCents: 1000,
      status: "confirmed", soldAt: "2026-11-01T12:00:00.000Z"
    }]} status="cancelled" loading onStatusChange={() => undefined} />);
    expect(html).toContain("Atualizando vendas");
    expect(html).not.toContain("VD-STALE");
  });
});

describe("representative sale reference", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses a valid HTML pattern that accepts references and rejects spaces", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<SaleForm representativeCode="REP-TEST" inventory={[{
      variantId: "variant-test", productName: "Item", sku: "SKU-1", color: "Preto",
      size: "34", priceInCents: 1000, quantity: 1
    }]} onSaved={() => undefined} />);
    const input = html.match(/<input\b(?=[^>]*\bname="reference")[^>]*>/)?.[0];
    const pattern = input?.match(/\bpattern="([^"]+)"/)?.[1];
    expect(pattern).toBeDefined();
    const reference = new RegExp("^(?:" + pattern + ")$", "v");
    expect(reference.test("TESTE-123/45")).toBe(true);
    expect(reference.test("referência inválida")).toBe(false);
  });
});
