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

const imageSizes = "(max-width: 700px) 22vw, 120px";

export function CategoryCarousel({ categories }: CategoryCarouselProps) {
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback(() => {
    const node = list.current;
    if (!node) return;
    const maxScroll = node.scrollWidth - node.clientWidth;
    setEdges({ start: node.scrollLeft > 4, end: node.scrollLeft < maxScroll - 4 });
  }, []);

  useEffect(() => {
    updateEdges();
    const node = list.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateEdges);
      return () => window.removeEventListener("resize", updateEdges);
    }
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateEdges, categories.length]);

  const move = (direction: -1 | 1) => {
    const node = list.current;
    if (!node) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <div className="category-circles">
      <ul className="category-circles-list" ref={list} aria-label="Categorias" onScroll={updateEdges}>
        {categories.map((category) => {
          const srcSet = categoryImageSrcSet(category.image);
          return (
            <li className="category-circles-item" key={category.href}>
              <Link className="category-circles-link" href={category.href} prefetch={false}>
                <span className="category-circles-image">
                  {srcSet ? (
                    <picture>
                      <source type="image/webp" srcSet={srcSet} sizes={imageSizes} />
                      <img
                        src={category.image}
                        srcSet={srcSet}
                        sizes={imageSizes}
                        alt=""
                        width={120}
                        height={120}
                        loading="lazy"
                        decoding="async"
                        data-original-src={category.image}
                        onError={recoverCategoryImage}
                      />
                    </picture>
                  ) : (
                    <img
                      src={category.image}
                      alt=""
                      width={120}
                      height={120}
                      loading="lazy"
                      decoding="async"
                      data-original-src={category.image}
                      onError={recoverCategoryImage}
                    />
                  )}
                </span>
                <span className="category-circles-name">{category.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="category-circles-arrow category-circles-arrow-previous"
        data-visible={edges.start}
        aria-label="Categorias anteriores"
        onClick={() => move(-1)}
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      <button
        type="button"
        className="category-circles-arrow category-circles-arrow-next"
        data-visible={edges.end}
        aria-label="Próximas categorias"
        onClick={() => move(1)}
      >
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
  );
}
