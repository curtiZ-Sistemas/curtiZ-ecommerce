"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { categoryImageSrcSet } from "../lib/responsive-storefront-image";

type CategoryItem = {
  name: string;
  href: string;
  image: string;
};

type CategoryCarouselProps = {
  categories: CategoryItem[];
};

function recoverCategoryImage(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const originalSrc = image.dataset.originalSrc ?? image.src;
  const picture = image.closest("picture");

  if (!image.dataset.sourceRetried && image.currentSrc !== image.src) {
    image.dataset.sourceRetried = "true";
    picture?.querySelectorAll("source").forEach((source) => source.removeAttribute("srcset"));
    image.removeAttribute("srcset");
    image.src = originalSrc;
    return;
  }

  if (image.dataset.placeholderApplied) return;
  image.dataset.placeholderApplied = "true";
  picture?.querySelectorAll("source").forEach((source) => source.removeAttribute("srcset"));
  image.removeAttribute("srcset");
  image.src = "/images/product-unavailable.svg";
}

export function CategoryCarousel({
  categories
}: CategoryCarouselProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<number | null>(null);
  const hovered = useRef(false);
  const pauseBriefly = useCallback(() => {
    setPaused(true);
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      if (!hovered.current) setPaused(false);
    }, 3000);
  }, []);
  useEffect(() => () => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
  }, []);
  const move = useCallback((direction: -1 | 1) => {
    const node = viewport.current;
    if (!node) return;
    const maximum = node.scrollWidth - node.clientWidth;
    const atStart = node.scrollLeft <= 2;
    const atEnd = node.scrollLeft >= maximum - 2;
    const left = direction < 0 && atStart
      ? maximum
      : direction > 0 && atEnd
        ? 0
        : node.scrollLeft + direction * node.clientWidth * 0.82;
    node.scrollTo({ left, behavior: "smooth" });
  }, []);
  const imageSizes = "(max-width: 700px) calc((100vw - 48px) * 0.82 * 0.68), (max-width: 1000px) 27vw, 19vw";
  const categorySrcSet = (image: string) => categoryImageSrcSet(image);

  useEffect(() => {
    if (paused || categories.length < 2) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (!document.hidden && !reducedMotion.matches) move(1);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [categories.length, move, paused]);

  return (
    <div className="category-carousel">
      <div
        className="category-carousel-viewport"
        ref={viewport}
        aria-label="Carrossel de categorias"
        onPointerDown={pauseBriefly}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") { hovered.current = true; setPaused(true); } }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") { hovered.current = false; if (!resumeTimer.current) setPaused(false); } }}
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
                prefetch={false}
              >
                <div>
                  <h3>{category.name}</h3>

                  <span>
                    Ver produtos
                    <ArrowRight aria-hidden="true" />
                  </span>
                </div>

                {categorySrcSet(category.image) ? (
                  <picture>
                    <source
                      type="image/webp"
                      srcSet={categorySrcSet(category.image) ?? undefined}
                      sizes={imageSizes}
                    />
                    <img
                      src={category.image}
                      srcSet={categorySrcSet(category.image) ?? undefined}
                      sizes={imageSizes}
                      alt=""
                      width={540}
                      height={540}
                      loading="lazy"
                      decoding="async"
                      aria-hidden="true"
                      data-original-src={category.image}
                      onError={recoverCategoryImage}
                    />
                  </picture>
                ) : (
                  <img
                    src={category.image}
                    alt=""
                    width={250}
                    height={140}
                    loading="lazy"
                    decoding="async"
                    aria-hidden="true"
                    data-original-src={category.image}
                    onError={recoverCategoryImage}
                  />
                )}
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
          onClick={() => { pauseBriefly(); move(-1); }}
          aria-label="Categoria anterior"
        >
          <ArrowLeft aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => { pauseBriefly(); move(1); }}
          aria-label="Próxima categoria"
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
