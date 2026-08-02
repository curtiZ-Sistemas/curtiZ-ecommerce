import { ArrowRight } from "lucide-react";
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
      <section
        className="hero container"
        aria-label="Destaques da coleção Curtiz"
      >
        <div className="hero-media hero-media-desktop">
          <Image
            src="/images/hero-curtiz-desktop.png"
            alt="Coleção Curtiz com opções para toda a família"
            width={1600}
            height={560}
            sizes="(min-width: 701px) calc(100vw - 48px), 0px"
            priority
          />
        </div>

        <div className="hero-media hero-media-mobile">
          <Image
            src="/images/hero-curtiz-mobile.png"
            alt="Coleção Curtiz com opções para toda a família"
            width={800}
            height={1170}
            sizes="(max-width: 700px) calc(100vw - 24px), 0px"
            priority
          />
        </div>

        <div className="hero-actions">
          <Link className="secondary-button" href="/lancamentos">
            Conheça os lançamentos
            <ArrowRight aria-hidden="true" />
          </Link>

          <Link className="hero-text-link" href="/produtos">
            Explorar produtos
          </Link>
        </div>
      </section>

      <section
        className="section container reveal-section"
        aria-labelledby="categorias-title"
      >
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

                <span>
                  Ver produtos
                  <ArrowRight aria-hidden="true" />
                </span>
              </div>

              {product && (
                <Image
                  src={product.image}
                  alt=""
                  width={250}
                  height={140}
                  aria-hidden="true"
                />
              )}
            </Link>
          ))}
        </div>
      </section>

      <section
        className="section container reveal-section"
        aria-labelledby="ofertas-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Seleção especial</p>
            <h2 id="ofertas-title">Ofertas em destaque</h2>
          </div>

          <Link className="text-link section-link" href="/ofertas">
            Ver todas
            <ArrowRight aria-hidden="true" />
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