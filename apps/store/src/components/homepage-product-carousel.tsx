"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";
import { Children, type ReactNode } from "react";

export function HomepageProductCarousel({
  children,
  label
}: {
  children: ReactNode;
  label: string;
}) {
  const slides = Children.toArray(children);
  const [viewportRef, api] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 4,
    duration: 24
  });

  return (
    <div className="home-product-carousel">
      <button
        className="home-product-carousel-arrow previous"
        type="button"
        aria-label="Produtos anteriores"
        onClick={() => api?.scrollPrev()}
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      <div className="home-product-carousel-viewport" ref={viewportRef} aria-label={label}>
        <div className="home-product-carousel-track">
          {slides.map((slide, index) => (
            <div className="home-product-carousel-slide" key={index}>
              {slide}
            </div>
          ))}
        </div>
      </div>
      <button
        className="home-product-carousel-arrow next"
        type="button"
        aria-label="Próximos produtos"
        onClick={() => api?.scrollNext()}
      >
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
  );
}
