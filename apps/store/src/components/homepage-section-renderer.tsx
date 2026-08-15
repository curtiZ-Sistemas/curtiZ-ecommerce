import type { HomepageSection, HomepageSectionItem, Product } from "@curtiz/domain";
import { ArrowRight, Headphones, PackageCheck, ShieldCheck, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CategoryCarousel } from "./category-carousel";
import { HomepageCountdown, HomepageMetric } from "./homepage-section-runtime";
import { HomepageHero } from "./homepage-hero";
import { ProductCard } from "./product-card";
import type { HomepageData, PublicBanner } from "@/lib/storefront-data";

const categoryRoutes = new Map([["Masculino", "/masculino"], ["Feminino", "/feminino"], ["Infantil", "/infantil"], ["Slides", "/slides"], ["Sandálias", "/sandalias"]]);
const productTypes = new Set(["product_carousel", "product_grid", "product_horizontal", "promotions", "flash_offers", "best_sellers", "launches", "featured_products", "recommended_products", "manual_products"]);
const taxonomyTypes = new Set(["models_grid", "brands_strip", "collections_grid", "campaigns", "quick_links"]);
const imageTypes = new Set(["image_links", "image_mosaic", "image_text"]);

const settingString = (section: HomepageSection, key: string, fallback = "") => { const value = section.content[key]; return typeof value === "string" ? value : fallback; };
const settingNumber = (section: HomepageSection, key: string, fallback: number) => { const value = section.content[key]; return typeof value === "number" && Number.isFinite(value) ? value : fallback; };
const settingBoolean = (section: HomepageSection, key: string, fallback: boolean) => { const value = section.content[key]; return typeof value === "boolean" ? value : fallback; };
const styleToken = (section: HomepageSection, key: string, allowed: readonly string[], fallback: string) => { const value = section.style[key]; return typeof value === "string" && allowed.includes(value) ? value : fallback; };
const bannersFor = (data: HomepageData, section: HomepageSection): PublicBanner[] => {
  const position = settingString(section, "position", section.sectionType === "banner_hero" ? "hero" : section.sectionType);
  const matches = data.banners.filter((banner) => banner.position === position);
  return (matches.length ? matches : section.sectionType === "banner_hero" ? data.banners : []).slice(0, 4);
};
const sectionClass = (section: HomepageSection) => {
  const spacingTop = styleToken(section, "spacingTop", ["none", "small", "medium", "large"], "medium");
  const spacingBottom = styleToken(section, "spacingBottom", ["none", "small", "medium", "large"], "medium");
  const background = styleToken(section, "background", ["default", "subtle", "brand", "dark"], "default");
  return `home-builder-section home-layout-${section.layout} home-visible-${section.visibility} home-space-top-${spacingTop} home-space-bottom-${spacingBottom} home-background-${background}`;
};
const mediaFor = (item: HomepageSectionItem, role: string) => item.media.find((media) => media.role === role) ?? item.media.find((media) => media.role === "desktop") ?? item.media[0];

function productsFor(section: HomepageSection, products: Product[]) {
  const limit = Math.min(24, Math.max(1, settingNumber(section, "limit", 8)));
  let selected = products;
  if (section.sectionType === "manual_products" || settingString(section, "source") === "manual") {
    const ids = section.items.filter((item) => item.targetType === "product").map((item) => item.targetId);
    selected = ids.flatMap((id) => { const product = products.find((item) => item.id === id); return product ? [product] : []; });
  } else if (["promotions", "flash_offers"].includes(section.sectionType)) {
    selected = products.filter((product) => product.compareAtPriceInCents && product.compareAtPriceInCents > product.priceInCents);
  } else if (section.sectionType === "featured_products") {
    selected = products.filter((product) => product.featured);
  } else if (section.sectionType === "recommended_products") {
    selected = [...products].sort((left, right) => right.rating - left.rating || right.reviews - left.reviews);
  }
  return selected.slice(0, limit);
}

export function HomepageSectionRenderer({ data, section, priority }: { data: HomepageData; section: HomepageSection; priority: boolean }) {
  if (section.sectionType === "banner_hero") {
    const banners = bannersFor(data, section);
    if (!banners.length) return null;
    return <HomepageMetric versionId={section.versionId}><HomepageHero banners={banners} /></HomepageMetric>;
  }
  if (section.sectionType === "categories_grid" && section.items.length === 0) {
    const categories = [...categoryRoutes.entries()].map(([name, href]) => ({ name, href, product: data.products.find((product) => product.category === name) })).filter((category) => category.product);
    if (!categories.length) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Encontre seu estilo"} title={section.title ?? "Para todos os momentos"} /><CategoryCarousel categories={categories.map(({ name, href, product }) => ({ name, href, image: product!.image }))} /></section></HomepageMetric>;
  }
  if (productTypes.has(section.sectionType)) {
    const products = productsFor(section, data.products);
    if (!products.length) return null;
    const carousel = section.layout === "carousel" || section.sectionType.includes("carousel") || section.sectionType === "product_horizontal";
    const display = { price: settingBoolean(section, "showPrice", true), rating: settingBoolean(section, "showRating", true), discount: settingBoolean(section, "showDiscount", true), installments: settingBoolean(section, "showInstallments", false), favorite: settingBoolean(section, "showFavorite", true), stock: settingBoolean(section, "showStock", false), badge: settingBoolean(section, "showBadge", true), purchase: settingBoolean(section, "showPurchase", false) };
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Seleção curti Z"} title={section.title ?? "Produtos selecionados"} href={settingString(section, "href", "/produtos")} /><div className={carousel ? "home-product-row" : "product-grid"}>{products.map((product, index) => <ProductCard product={product} display={display} priority={priority && index < 2} key={product.id} />)}</div></section></HomepageMetric>;
  }
  if (taxonomyTypes.has(section.sectionType) || (section.sectionType === "categories_grid" && section.items.length > 0)) {
    const validItems = section.items.filter((item) => item.targetRoute);
    if (!validItems.length) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Explore"} title={section.title ?? "Descubra a curti Z"} /><div className="home-taxonomy-grid">{validItems.map((item) => <SafeItemLink item={item} key={item.id}><ItemImage item={item} priority={priority} /><strong>{item.title ?? item.internalName}</strong>{item.description && <span>{item.description}</span>}</SafeItemLink>)}</div></section></HomepageMetric>;
  }
  if (imageTypes.has(section.sectionType)) {
    const items = section.items.filter((item) => item.media.length);
    if (!items.length) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Em destaque"} title={section.title ?? "Escolhas curti Z"} /><div className={`home-image-layout home-image-${section.layout}`}>{items.map((item) => <SafeItemLink item={item} key={item.id}><ItemImage item={item} priority={priority} /><span className="home-image-copy">{item.title && <strong>{item.title}</strong>}{item.subtitle && <small>{item.subtitle}</small>}</span></SafeItemLink>)}</div></section></HomepageMetric>;
  }
  if (section.sectionType === "video") {
    const item = section.items.find((candidate) => mediaFor(candidate, "video")?.mimeType.startsWith("video/")); const media = item ? mediaFor(item, "video") : null;
    if (!item || !media) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Vídeo"} title={section.title ?? item.title ?? "Conteúdo curti Z"} /><video className="home-editorial-video" controls preload="metadata" poster={mediaFor(item, "thumbnail")?.path}><source src={media.path} type={media.mimeType} />Seu navegador não reproduz este vídeo.</video></section></HomepageMetric>;
  }
  if (section.sectionType === "countdown") {
    if (!section.endsAt) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Tempo limitado"} title={section.title ?? "A oferta termina em"} /><HomepageCountdown endsAt={section.endsAt} /></section></HomepageMetric>;
  }
  if (section.sectionType === "reviews_carousel") {
    const reviewed = [...data.products].filter((product) => product.reviews > 0).sort((left, right) => right.rating - left.rating).slice(0, 4);
    if (!reviewed.length) return null;
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Avaliações verificadas"} title={section.title ?? "Modelos bem avaliados"} /><div className="home-review-grid">{reviewed.map((product) => <Link href={`/produto/${product.slug}`} data-home-item={product.id} key={product.id}><strong>{product.rating.toLocaleString("pt-BR")} de 5</strong><span>{product.name}</span><small>{product.reviews.toLocaleString("pt-BR")} avaliações publicadas</small></Link>)}</div></section></HomepageMetric>;
  }
  if (section.sectionType === "benefits" || section.sectionType === "safe_component") {
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container home-benefits`} aria-labelledby={`${section.id}-title`}><SectionHeading id={`${section.id}-title`} eyebrow={section.subtitle ?? "Experiência de compra"} title={section.title ?? "Comprar na curti Z é simples"} /><div className="benefits-grid"><Benefit icon={<ShoppingBag />} title="Carrinho preservado" text="Monte sua seleção antes de entrar." /><Benefit icon={<ShieldCheck />} title="Compra protegida" text="Preço e estoque são validados no servidor." /><Benefit icon={<PackageCheck />} title="Acompanhamento" text="Pedidos ficam organizados na sua conta." /><Benefit icon={<Headphones />} title="Atendimento" text="Central de ajuda acessível em toda a loja." /></div></section></HomepageMetric>;
  }
  if (["editorial", "institutional", "newsletter"].includes(section.sectionType)) {
    return <HomepageMetric versionId={section.versionId}><section className={`${sectionClass(section)} container home-editorial`} aria-labelledby={`${section.id}-title`}><div><p className="eyebrow">{section.subtitle ?? (section.sectionType === "newsletter" ? "Novidades" : "curti Z")}</p><h2 id={`${section.id}-title`}>{section.title ?? (section.sectionType === "newsletter" ? "Acompanhe as novidades da curti Z" : "Conteúdo curti Z")}</h2>{section.description && <p>{section.description}</p>}<Link className="primary-button" href={section.items[0]?.targetRoute ?? (section.sectionType === "newsletter" ? "/cadastro" : "/produtos")} data-home-item={section.items[0]?.id ?? "action"}>{section.items[0]?.title ?? (section.sectionType === "newsletter" ? "Criar conta" : "Conhecer produtos")} <ArrowRight /></Link></div>{section.items[0]?.media.length ? <ItemImage item={section.items[0]} priority={priority} /> : null}</section></HomepageMetric>;
  }
  return null;
}

function ItemImage({ item, priority }: { item: HomepageSectionItem; priority: boolean }) {
  const desktop = mediaFor(item, "desktop"); const mobile = mediaFor(item, "mobile") ?? desktop;
  if (!desktop) return null;
  return <picture><source media="(max-width: 700px)" srcSet={mobile?.path} /><Image src={desktop.path} alt={desktop.decorative ? "" : desktop.altText ?? item.altText ?? ""} width={desktop.width ?? 900} height={desktop.height ?? 600} sizes="(max-width: 700px) 100vw, 50vw" priority={priority} /></picture>;
}
function SafeItemLink({ item, children }: { item: HomepageSectionItem; children: React.ReactNode }) {
  if (!item.targetRoute) return <article>{children}</article>;
  const external = item.targetRoute.startsWith("https://");
  return <Link href={item.targetRoute} data-home-item={item.id} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</Link>;
}
function Benefit({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="benefit">{icon}<div><strong>{title}</strong><span>{text}</span></div></div>; }
function SectionHeading({ id, eyebrow, title, href }: { id: string; eyebrow: string; title: string; href?: string }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div>{href && <Link className="text-link section-link" href={href}>Ver todos <ArrowRight aria-hidden="true" /></Link>}</div>; }
