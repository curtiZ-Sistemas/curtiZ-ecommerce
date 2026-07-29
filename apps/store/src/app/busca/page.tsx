import { CatalogPage } from "@/components/catalog-page";
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <CatalogPage title={`Busca${q ? ` por “${q}”` : ""}`} description="Resultados ordenados por relevância." />;
}
