import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { HomepageSectionRenderer } from "@/components/homepage-section-renderer";
import { HomepageHero } from "@/components/homepage-hero";
import { HomepageMetric } from "@/components/homepage-section-runtime";
import { orderHomepageSections } from "@/lib/homepage-layout";
import { JsonLd } from "@/components/json-ld";
import { catalogNavigationStructuredData, homeMetadata } from "@/lib/seo";
import { getHomepageData } from "@/lib/storefront-data";

export const dynamic = "force-dynamic";
export const metadata = homeMetadata;

export default async function HomePage() {
  const data = await getHomepageData();
  const unavailable = data.sections.length === 0;
  const sections = orderHomepageSections(data.sections);
  const primary = sections.find((section) => section.sectionType === "banner_hero");
  const position = typeof primary?.content.position === "string" ? primary.content.position : "hero";
  const campaigns = data.banners.filter((banner) => banner.position === position).slice(1);
  const editorialIndex = Math.max(1, sections.findIndex((section) => section.sectionType === "categories_grid"));
  return <>
    <JsonLd data={catalogNavigationStructuredData} />
    {unavailable && <section className="section container"><div className="empty-state" role="status"><ShoppingBag aria-hidden="true" /><h1>Página inicial temporariamente indisponível</h1><p>Não foi possível carregar o conteúdo publicado agora.</p><Link className="secondary-button" href="/produtos">Ver produtos</Link></div></section>}
    {sections.map((section, index) => <div className="home-section-slot" key={`${section.id}-${section.versionId ?? "default"}`}>
      <HomepageSectionRenderer data={data} section={section} priority={index === 0} />
      {index === editorialIndex && campaigns.map((banner) => <HomepageMetric versionId={primary?.versionId} key={banner.id}><HomepageHero banners={[banner]} secondary /></HomepageMetric>)}
    </div>)}
  </>;
}
