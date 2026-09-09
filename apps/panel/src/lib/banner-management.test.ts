import { describe, expect, it, vi } from "vitest";
import {
  bannerFailure,
  normalizeBannerValues,
  validateBannerReferences
} from "./banner-management";

const image =
  "banners/10000000-0000-4000-8000-000000000001/desktop-10000000-0000-4000-8000-000000000002.webp";
const input = {
  image_path_desktop: image,
  image_path_mobile: image,
  destination_type: "internal_page",
  destination_id: "produtos",
  destination_url: "/produtos",
  destination_type_mobile: "none"
};

describe("banner mutation contract", () => {
  it("never sends internal page slugs to UUID columns and supplies legacy defaults", () => {
    expect(
      normalizeBannerValues(
        { ...input, priority: null, sort_order: null, status: null, content_alignment: null },
        true
      )
    ).toMatchObject({
      destination_id: null,
      destination_id_mobile: null,
      destination_url_mobile: "/",
      title: "Destaque curti Z",
      status: "published",
      priority: 0,
      sort_order: 0,
      content_alignment: "center"
    });
  });
  it("does not reset publication or presentation when editing", () => {
    const values = normalizeBannerValues(input, false);
    for (const key of ["status", "position", "starts_at", "ends_at", "title", "priority"])
      expect(values).not.toHaveProperty(key);
  });
  it.each(["image_path_desktop", "image_path_mobile"])("requires %s", (key) => {
    expect(() => normalizeBannerValues({ ...input, [key]: "" }, true)).toThrow("Informe a imagem");
  });
  it.each([
    "javascript:alert(1)",
    "//evil.example",
    "/\\evil.example",
    "/%5cevil.example",
    "/%0aevil.example"
  ])("rejects unsafe mobile route %s", (route) => {
    expect(() =>
      normalizeBannerValues(
        { ...input, destination_type_mobile: "internal_page", destination_url_mobile: route },
        true
      )
    ).toThrow();
  });
  it("preserves different destinations and rejects fake entity ids", () => {
    expect(
      normalizeBannerValues(
        {
          ...input,
          destination_type_mobile: "internal_page",
          destination_url_mobile: "/ofertas",
          destination_id_mobile: "ofertas"
        },
        false
      )
    ).toMatchObject({
      destination_url: "/produtos",
      destination_url_mobile: "/ofertas",
      destination_id_mobile: null
    });
    expect(() =>
      normalizeBannerValues(
        { ...input, destination_type: "product", destination_id: "produtos" },
        true
      )
    ).toThrow("Escolha um destino existente");
  });
  it("checks storage existence instead of trusting a frontend path", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { storage: { from: () => ({ list }) } } as unknown as Parameters<
      typeof validateBannerReferences
    >[0];
    await expect(
      validateBannerReferences(client, normalizeBannerValues(input, true))
    ).rejects.toThrow("o arquivo não foi confirmado");
    expect(list).toHaveBeenCalled();
  });
  it("preserves a legacy single image on edit without requiring it to be uploaded again", async () => {
    const list = vi.fn();
    const client = { storage: { from: () => ({ list }) } } as unknown as Parameters<
      typeof validateBannerReferences
    >[0];
    const values = normalizeBannerValues(
      { ...input, image_path_desktop: "/images/old.webp", image_path_mobile: "/images/old.webp" },
      false
    );
    await expect(
      validateBannerReferences(client, values, {
        image_path_desktop: "/images/old.webp",
        image_path_mobile: ""
      })
    ).resolves.toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });
  it("resolves the product route on the server, ignoring a forged frontend route", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { slug: "chinelo-slim", name: "Chinelo Slim" },
              error: null
            })
          })
        })
      })
    } as unknown as Parameters<typeof validateBannerReferences>[0];
    const values = normalizeBannerValues(
      {
        ...input,
        destination_type: "product",
        destination_id: "10000000-0000-4000-8000-000000000001",
        destination_url: "/forged"
      },
      false
    );
    await validateBannerReferences(client, values, { image_path_desktop: image });
    expect(values.destination_url).toBe("/produto/chinelo-slim");
    expect(values.destination_type_mobile).toBe("none");
  });
  it("logs diagnostic codes without row data and distinguishes schema and permission failures", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(bannerFailure({ code: "PGRST204", message: "missing column" }, "create")).toContain(
      "atualização do banco"
    );
    expect(bannerFailure({ code: "42501" }, "edit")).toContain("permissão");
    expect(
      bannerFailure(
        { code: "23502", message: 'null value in column "priority" violates not-null constraint' },
        "create"
      )
    ).toContain("Tente novamente");
    expect(log.mock.calls[2]?.[1]).toEqual({
      code: "23502",
      operation: "create",
      constraint: "priority"
    });
    log.mockRestore();
  });
});
