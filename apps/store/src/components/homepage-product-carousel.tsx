"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Children, type ReactNode, useCallback, useRef } from "react";

export function HomepageProductCarousel({
  children,
  label
}: {
  children: ReactNode;
  label: string;
}) {
  const slides = Children.toArray(children);
  const viewport = useRef<HTMLDivElement>(null);
  const move = useCallback((direction: -1 | 1) => {
    const node = viewport.current;
    if (!node) return;
    const maximum = node.scrollWidth - node.clientWidth;
    const atStart = node.scrollLeft <= 2;
    const atEnd = node.scrollLeft >= maximum - 2;
    node.scrollTo({
      left: direction < 0 && atStart
        ? maximum
        : direction > 0 && atEnd
          ? 0
          : node.scrollLeft + direction * node.clientWidth,
      behavior: "smooth"
    });
  }, []);

  return (
    <div className="home-product-carousel">
      <button
        className="home-product-carousel-arrow previous"
        type="button"
        aria-label="Produtos anteriores"
        onClick={() => move(-1)}
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      <div className="home-product-carousel-viewport" ref={viewport} aria-label={label}>
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
        onClick={() => move(1)}
      >
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
  );
}
