"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import { useEffect, useRef } from "react";

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
  const autoplay = useRef(
    Autoplay({
      delay: 4200,
      stopOnInteraction: true,
      stopOnMouseEnter: true
    })
  );

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateAutoplay = () => {
      if (reducedMotion.matches) autoplay.current.stop();
    };
    updateAutoplay();
    reducedMotion.addEventListener("change", updateAutoplay);
    return () => reducedMotion.removeEventListener("change", updateAutoplay);
  }, []);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: true,
      align: "center",
      slidesToScroll: 1,
      dragFree: false,
      skipSnaps: false,
      duration: 28
    },
    [autoplay.current]
  );

  const previous = () => {
    emblaApi?.scrollPrev();
    autoplay.current.reset();
  };

  const next = () => {
    emblaApi?.scrollNext();
    autoplay.current.reset();
  };

  return (
    <div className="category-carousel">
      <div
        className="category-carousel-viewport"
        ref={emblaRef}
        aria-label="Carrossel de categorias"
      >
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
