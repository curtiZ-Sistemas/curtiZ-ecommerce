import { postgresUuidSchema } from "@curtiz/security/postgres-uuid";

export const bannerPages = [
  { id: "inicio", label: "Página inicial", route: "/" },
  { id: "produtos", label: "Todos os produtos", route: "/produtos" },
  { id: "ofertas", label: "Ofertas", route: "/ofertas" },
  { id: "lancamentos", label: "Lançamentos", route: "/lancamentos" },
  { id: "mais-vendidos", label: "Mais vendidos", route: "/mais-vendidos" },
  { id: "atendimento", label: "Atendimento", route: "/atendimento" }
];
export const bannerDestinationTypes = [
  "none",
  "product",
  "category",
  "collection",
  "institutional_page",
  "guide",
  "campaign",
  "internal_page",
  "predefined_search",
  "external_url"
] as const;
const hasControl = (value: string, includeSpace = false) =>
  Array.from(value).some((character) => character.charCodeAt(0) < (includeSpace ? 33 : 32));

export function normalizeBannerValues(input: Record<string, unknown>, creating: boolean) {
  const result: Record<string, unknown> = {};
  for (const device of ["desktop", "mobile"] as const) {
    const image = input[`image_path_${device}`];
    if (
      typeof image !== "string" ||
      !image.trim() ||
      image.length > 1000 ||
      hasControl(image) ||
      image.includes("\\") ||
      image.includes("..")
    ) {
      throw new Error(`Informe a imagem para ${device === "desktop" ? "computador" : "celular"}.`);
    }
    result[`image_path_${device}`] = image.trim();
    const suffix = device === "desktop" ? "" : "_mobile";
    const type = input[`destination_type${suffix}`] ?? "none";
    if (
      typeof type !== "string" ||
      !bannerDestinationTypes.includes(type as (typeof bannerDestinationTypes)[number])
    )
      throw new Error("Escolha um destino válido.");
    const url = type === "none" ? "/" : input[`destination_url${suffix}`];
    if (typeof url !== "string" || url.length > 2000 || hasControl(url, true) || url.includes("\\"))
      throw new Error("Informe um destino válido.");
    if (type === "external_url") {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Informe uma URL HTTPS válida.");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error("Informe uma URL HTTPS válida.");
    } else if (!url.startsWith("/") || url.startsWith("//") || /%5c|%0[ad]/iu.test(url)) {
      throw new Error("Informe um destino interno válido.");
    }
    const entity = [
      "product",
      "category",
      "collection",
      "institutional_page",
      "guide",
      "campaign"
    ].includes(String(type));
    const id = entity ? input[`destination_id${suffix}`] : null;
    if (entity && !postgresUuidSchema.safeParse(id).success)
      throw new Error("Escolha um destino existente na lista.");
    result[`destination_type${suffix}`] = type;
    result[`destination_id${suffix}`] = id;
    result[`destination_url${suffix}`] = url;
  }
  if (creating)
    Object.assign(result, {
      title: "Destaque curti Z",
      internal_title: "Banner curti Z",
      alt_text: "Destaque curti Z",
      position: "hero",
      status: "published",
      sort_order: 0,
      priority: 0,
      content_alignment: "center",
      open_new_tab: false
    });
  return result;
}
