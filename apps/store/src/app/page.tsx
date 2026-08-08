import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { HomepageSectionRenderer } from "@/components/homepage-section-renderer";
import { getHomepageData } from "@/lib/storefront-data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getHomepageData();
  const unavailable = data.sections.length === 0;
  return <>
    {unavailable && <section className="section container"><div className="empty-state" role="status"><ShoppingBag aria-hidden="true" /><h1>Página inicial temporariamente indisponível</h1><p>Não foi possível carregar o conteúdo publicado agora.</p><Link className="secondary-button" href="/produtos">Ver produtos</Link></div></section>}
    {data.sections.map((section, index) => <HomepageSectionRenderer data={data} section={section} priority={index === 0} key={`${section.id}-${section.versionId ?? "default"}`} />)}
  </>;
}
