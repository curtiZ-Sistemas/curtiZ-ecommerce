import type { HomepageSection } from "@curtiz/domain";
import { ArrowRight, Headphones, PackageCheck, ShieldCheck, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { HomepageHero } from "@/components/homepage-hero";
import { ProductCard } from "@/components/product-card";
import { getHomepageData, type HomepageData, type PublicBanner } from "@/lib/storefront-data";
import { CategoryCarousel } from "@/components/category-carousel";

const categoryRoutes = new Map([
  ["Masculino", "/masculino"],
  ["Feminino", "/feminino"],
  ["Infantil", "/infantil"],
  ["Slides", "/slides"],
  ["Sandálias", "/sandalias"]
]);

const settingString = (section: HomepageSection, key: string, fallback = "") => {
  const value = section.settings[key];
  return typeof value === "string" ? value : fallback;
};

const settingNumber = (section: HomepageSection, key: string, fallback: number) => {
  const value = section.settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const bannersFor = (data: HomepageData, section: HomepageSection): PublicBanner[] => {
  const position = settingString(
    section,
    "position",
    section.sectionType === "banner_hero" ? "hero" : section.sectionType
  );
  const matches = data.banners.filter((banner) => banner.position === position);
  return (
    matches.length ? matches : section.sectionType === "banner_hero" ? data.banners : []
  ).slice(0, 4);
};

export default async function HomePage() {
  const data = await getHomepageData();
  const unavailable = data.banners.length === 0 && data.products.length === 0;
  return (
    <>
      {unavailable && (
        <section className="section container">
          <div className="empty-state" role="status">
            <ShoppingBag aria-hidden="true" />
            <h1>Catálogo temporariamente indisponível</h1>
            <p>Não foi possível carregar os produtos agora. Tente novamente em alguns instantes.</p>
            <Link className="secondary-button" href="/produtos">
              Tentar novamente
            </Link>
          </div>
        </section>
      )}
      {data.sections.map((section) => (
        <HomepageSectionRenderer data={data} section={section} key={section.id} />
      ))}
    </>
  );
}

function HomepageSectionRenderer({
  data,
  section
}: {
  data: HomepageData;
  section: HomepageSection;
}) {
  if (section.sectionType === "banner_hero") {
    return <HomepageHero banners={bannersFor(data, section)} />;
  }

  if (section.sectionType === "categories_grid") {
    const categories = [...categoryRoutes.entries()]
      .map(([name, href]) => ({
        name,
        href,
        product: data.products.find((product) => product.category === name)
      }))
      .filter((category) => category.product);
    if (!categories.length) return null;
    return (
      <section className="section container reveal-section" aria-labelledby={`${section.id}-title`}>
        <SectionHeading
          id={`${section.id}-title`}
          eyebrow={section.subtitle ?? "Encontre seu estilo"}
          title={section.title ?? "Para todos os momentos"}
        />
        <CategoryCarousel
          categories={categories.map(({ name, href, product }) => ({
            name,
            href,
            image: product!.image
          }))}
        />
      </section>
    );
  }

  if (section.sectionType === "featured_products") {
    const limit = Math.min(12, Math.max(1, settingNumber(section, "limit", 8)));
    const products = data.products.slice(0, limit);
    if (!products.length) return null;
    const href = settingString(section, "href", "/produtos");
    return (
      <section className="section container reveal-section" aria-labelledby={`${section.id}-title`}>
        <SectionHeading
          id={`${section.id}-title`}
          eyebrow={section.subtitle ?? "Seleção curti Z"}
          title={section.title ?? "Produtos em destaque"}
          href={href}
        />
        <div className="product-grid">
          {products.map((product, index) => (
            <ProductCard product={product} priority={index < 2} key={product.id} />
          ))}
        </div>
      </section>
    );
  }

  if (section.sectionType === "banner_promo" || section.sectionType === "custom_banner") {
    const banners = bannersFor(data, section);
    if (!banners.length) return null;
    return (
      <section
        className="section container home-campaigns"
        aria-label={section.title ?? "Campanha"}
      >
        {banners.map((banner) => (
          banner.href ? <Link href={banner.href} className="home-campaign-banner" key={banner.id} target={banner.openNewTab ? "_blank" : undefined} rel={banner.openNewTab ? "noopener noreferrer" : undefined}>
            <Image
              className="home-campaign-desktop"
              src={banner.desktopImage}
              alt={banner.altText}
              width={1440}
              height={420}
              sizes="(min-width: 701px) calc(100vw - 48px), 0px"
            />
            <Image
              className="home-campaign-mobile"
              src={banner.mobileImage}
              alt={banner.altText}
              width={720}
              height={840}
              sizes="(max-width: 700px) calc(100vw - 24px), 0px"
            />
          </Link> : <div className="home-campaign-banner" key={banner.id}>
            <Image className="home-campaign-desktop" src={banner.desktopImage} alt={banner.altText} width={1440} height={420} sizes="(min-width: 701px) calc(100vw - 48px), 0px" />
            <Image className="home-campaign-mobile" src={banner.mobileImage} alt={banner.altText} width={720} height={840} sizes="(max-width: 700px) calc(100vw - 24px), 0px" />
          </div>
        ))}
      </section>
    );
  }

  if (section.sectionType === "reviews_carousel") {
    const reviewed = data.products.filter((product) => product.reviews > 0).slice(0, 4);
    if (!reviewed.length) return null;
    return (
      <section className="section container" aria-labelledby={`${section.id}-title`}>
        <SectionHeading
          id={`${section.id}-title`}
          eyebrow={section.subtitle ?? "Avaliações verificadas"}
          title={section.title ?? "Modelos bem avaliados"}
        />
        <div className="home-review-grid">
          {reviewed.map((product) => (
            <Link href={`/produto/${product.slug}`} key={product.id}>
              <strong>{product.rating.toLocaleString("pt-BR")} de 5</strong>
              <span>{product.name}</span>
              <small>{product.reviews.toLocaleString("pt-BR")} avaliações publicadas</small>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  if (section.sectionType === "brands_strip") {
    return (
      <section className="section container home-benefits" aria-labelledby={`${section.id}-title`}>
        <SectionHeading
          id={`${section.id}-title`}
          eyebrow="Experiência de compra"
          title={section.title ?? "Comprar na curti Z é simples"}
        />
        <div className="benefits-grid">
          <div className="benefit">
            <ShoppingBag />
            <div>
              <strong>Carrinho preservado</strong>
              <span>Monte sua seleção antes de entrar.</span>
            </div>
          </div>
          <div className="benefit">
            <ShieldCheck />
            <div>
              <strong>Compra protegida</strong>
              <span>Preço e estoque são validados no servidor.</span>
            </div>
          </div>
          <div className="benefit">
            <PackageCheck />
            <div>
              <strong>Acompanhamento</strong>
              <span>Pedidos ficam organizados na sua conta.</span>
            </div>
          </div>
          <div className="benefit">
            <Headphones />
            <div>
              <strong>Atendimento</strong>
              <span>Central de ajuda acessível em toda a loja.</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return null;
}

function SectionHeading({
  id,
  eyebrow,
  title,
  href
}: {
  id: string;
  eyebrow: string;
  title: string;
  href?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {href && (
        <Link className="text-link section-link" href={href}>
          Ver todos <ArrowRight aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
