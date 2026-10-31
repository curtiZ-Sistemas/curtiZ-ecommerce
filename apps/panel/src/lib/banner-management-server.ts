import "server-only";
import { logServerEvent } from "@curtiz/security";
import { bannerPages } from "./banner-management";
import type { authorizeAdminRequest } from "./admin-api";
type Client = NonNullable<Awaited<ReturnType<typeof authorizeAdminRequest>>>["supabase"];

export async function validateBannerReferences(
  client: Client,
  values: Record<string, unknown>,
  previous?: Record<string, unknown>
) {
  for (const device of ["desktop", "mobile"] as const) {
    const key = `image_path_${device}`;
    const path = String(values[key]);
    if (previous && [previous.image_path_desktop, previous.image_path_mobile].includes(path))
      continue;
    if (!/^banners\/[0-9a-f-]+\/(desktop|mobile)-[0-9a-f-]+\.(jpg|png|webp)$/iu.test(path))
      throw new Error(
        `Informe uma imagem enviada para ${device === "desktop" ? "computador" : "celular"}.`
      );
    const directory = path.slice(0, path.lastIndexOf("/"));
    const name = path.slice(path.lastIndexOf("/") + 1);
    const files = await client.storage
      .from("catalog-public")
      .list(directory, { search: name, limit: 1 });
    if (files.error || !files.data?.some((file) => file.name === name))
      throw new Error(
        `Informe novamente a imagem para ${device === "desktop" ? "computador" : "celular"}; o arquivo não foi confirmado no armazenamento.`
      );
  }
  for (const suffix of ["", "_mobile"]) {
    const type = String(values[`destination_type${suffix}`]);
    const urlKey = `destination_url${suffix}`;
    const url = String(values[urlKey]);
    if (type === "none") continue;
    if (type === "internal_page") {
      if (!bannerPages.some((page) => page.route === url) && previous?.[urlKey] !== url)
        throw new Error("Escolha uma página interna da lista.");
      continue;
    }
    if (type === "predefined_search") {
      if (!url.startsWith("/busca?q=")) throw new Error("Informe uma busca válida.");
      continue;
    }
    if (type === "external_url") continue; // Both destinations also have a database host allowlist trigger.
    const table =
      type === "product"
        ? "products"
        : type === "category"
          ? "categories"
          : type === "collection"
            ? "collections"
            : type === "campaign"
              ? "promotion_campaigns"
              : "cms_pages";
    const record = await client
      .from(table)
      .select(
        type === "campaign"
          ? "id,name"
          : type === "institutional_page" || type === "guide"
            ? "id,title,slug"
            : "id,name,slug"
      )
      .eq("id", String(values[`destination_id${suffix}`]))
      .maybeSingle();
    if (record.error || !record.data)
      throw new Error("Escolha um destino existente; não foi possível confirmar o selecionado.");
    const row = record.data as unknown as Record<string, unknown>;
    const slug = typeof row.slug === "string" ? row.slug : "";
    const name = typeof row.name === "string" ? row.name : "";
    values[urlKey] =
      type === "product"
        ? `/produto/${slug}`
        : type === "category"
          ? `/produtos?categoria=${encodeURIComponent(name)}`
          : type === "collection"
            ? `/produtos?colecao=${encodeURIComponent(name)}`
            : type === "campaign"
              ? "/ofertas"
              : `/${slug}`;
  }
}

export function bannerFailure(error: { code?: string; message?: string }, operation: string) {
  // Do not log details: Postgres NOT NULL details can contain the entire failing row.
  logServerEvent("error", "banner_management.failure", {
    operation,
    code: error.code ?? "unknown",
    constraint: error.message?.match(/(?:constraint|column) "([a-z_]+)"/u)?.[1]
  });
  if (
    error.message?.includes("four active banners") ||
    error.message?.includes("four published banners")
  )
    return "Já existem quatro banners ativos. Desative um banner para continuar.";
  if (error.message?.includes("external banner host"))
    return "O domínio externo não está autorizado nas configurações administrativas.";
  if (["42703", "PGRST204", "42P01"].includes(error.code ?? ""))
    return "O cadastro de banners precisa de uma atualização do banco. Contate o responsável técnico.";
  if (error.code === "42501") return "Sua permissão não permite salvar este banner.";
  return "Não foi possível salvar o banner. Tente novamente.";
}
