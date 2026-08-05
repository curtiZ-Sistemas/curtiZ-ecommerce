"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";

type CategoryItem = {
  name: string;
  href: string;
  image: string;
};

type CategoryCarouselProps = {
  categories: CategoryItem[];
};

export function CategoryCarousel({
  categories
}: CategoryCarouselProps) {
    const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: "center",
    dragFree: false,
    skipSnaps: false,
    containScroll: false
    });

  const previous = () => {
    emblaApi?.scrollPrev();
  };

  const next = () => {
    emblaApi?.scrollNext();
  };

  return (
    <div className="category-carousel">
      <div className="category-carousel-viewport" ref={emblaRef}>
        <div className="category-carousel-track">
          {categories.map((category) => (
            <div
              className="category-carousel-slide"
              key={category.href}
            >
              <Link
                className="category-card"
                href={category.href}
              >
                <div>
                  <h3>{category.name}</h3>

                  <span>
                    Ver produtos
                    <ArrowRight aria-hidden="true" />
                  </span>
                </div>

                <Image
                  src={category.image}
                  alt=""
                  width={250}
                  height={140}
                  aria-hidden="true"
                />
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div
        className="category-carousel-controls"
        aria-label="Controles das categorias"
      >
        <button
          type="button"
          onClick={previous}
          aria-label="Categoria anterior"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={next}
          aria-label="Próxima categoria"
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}