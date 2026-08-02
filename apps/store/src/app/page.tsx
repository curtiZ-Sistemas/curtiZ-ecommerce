import {
  ArrowRight,
  Headphones,
  PackageCheck,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { demoProducts } from "@/lib/catalog";

const categories = [
  ["Masculino", "/masculino", demoProducts[0]],
  ["Feminino", "/feminino", demoProducts[1]],
  ["Infantil", "/infantil", demoProducts[4]],
  ["Slides", "/slides", demoProducts[2]]
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          <div className="hero-actions">
            <Link className="secondary-button" href="/lancamentos">
              Conheça os lançamentos <ArrowRight aria-hidden="true" />
            </Link>

            <Link className="hero-text-link" href="/produtos">
              Explorar produtos
            </Link>
          </div>
        </div>
      </section>

      <section className="section container reveal-section" aria-labelledby="categorias-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Encontre seu estilo</p>
            <h2 id="categorias-title">Para todos os momentos</h2>
          </div>
        </div>
        <div
          className="category-grid"
          role="list"
          aria-label="Categorias de produtos. Arraste horizontalmente no celular."
        >
          {categories.map(([name, href, product], index) => (
            <Link
              className="category-card"
              href={href}
              key={href}
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={categories.length}
            >
              <div>
                <h3>{name}</h3>
                <span>Ver produtos <ArrowRight aria-hidden="true" /></span>
              </div>
              {product && <Image src={product.image} alt="" width={250} height={140} aria-hidden="true" />}
            </Link>
          ))}
        </div>
      </section>


      <section className="section container reveal-section" aria-labelledby="ofertas-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Seleção especial</p>
            <h2 id="ofertas-title">Ofertas em destaque</h2>
          </div>
          <Link className="text-link section-link" href="/ofertas">
            Ver todas <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <div className="product-grid">
          {demoProducts.slice(0, 8).map((product) => (
            <ProductCard product={product} key={product.id} />
          ))}
        </div>
      </section>
    </>
  );
}
