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
const AUTOPLAY_MS = 3000;
const RESUME_MS = 4000;

// Três cópias da lista: a do meio é a real; as laterais permitem rolar sem fim para os dois lados.
const COPIES = 3;

export function CategoryCarousel({ categories }: CategoryCarouselProps) {
  const list = useRef<HTMLUListElement>(null);
  const setWidth = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const hovered = useRef(false);
  const positioned = useRef(false);
  const [looping, setLooping] = useState(true);
  const [paused, setPaused] = useState(false);

  // Largura de uma cópia (itens + espaçamentos); se a lista inteira cabe na tela, não há loop.
  const measure = useCallback(() => {
    const node = list.current;
    const first = node?.firstElementChild;
    if (!node || !(first instanceof HTMLElement) || categories.length === 0) return;
    const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
    const width = categories.length * (first.offsetWidth + gap);
    const previous = setWidth.current;
    setWidth.current = width;
    const shouldLoop = categories.length > 1 && width > node.clientWidth;
    setLooping(shouldLoop);
    if (!shouldLoop) {
      positioned.current = false;
      return;
    }
    // Só posiciona quando as três cópias já estão no DOM.
    if (node.children.length !== categories.length * COPIES) return;
    if (!positioned.current) {
      positioned.current = true;
      node.scrollLeft = width;
    } else if (Math.abs(previous - width) > 1) node.scrollLeft = width + ((node.scrollLeft % previous) / previous) * width;
  }, [categories.length]);

  useEffect(() => {
    measure();
    const node = list.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, looping]);

  // Ao parar de rolar, volta para a cópia do meio sem salto visível.
  const recenter = useCallback(() => {
    const node = list.current;
    const width = setWidth.current;
    if (!node || width <= 0 || !looping) return;
    if (node.scrollLeft < width * 0.5) node.scrollLeft += width;
    else if (node.scrollLeft >= width * 1.5) node.scrollLeft -= width;
  }, [looping]);

  const onScroll = useCallback(() => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      recenter();
    }, 120);
  }, [recenter]);

  const pauseBriefly = useCallback(() => {
    setPaused(true);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      if (!hovered.current) setPaused(false);
    }, RESUME_MS);
  }, []);

  useEffect(() => () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
  }, []);

  const move = useCallback((direction: -1 | 1) => {
    const node = list.current;
    const first = node?.firstElementChild;
    if (!node || !(first instanceof HTMLElement)) return;
    const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * (first.offsetWidth + gap), behavior: reducedMotion ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    if (!looping || paused) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (!document.hidden && !reducedMotion.matches) move(1);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [looping, move, paused]);

  const items = looping ? Array.from({ length: COPIES }, () => categories).flat() : categories;

  return (
    <div
      className="category-circles"
      data-looping={looping}
      onPointerDown={pauseBriefly}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") { hovered.current = true; setPaused(true); } }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") { hovered.current = false; if (resumeTimer.current === null) setPaused(false); } }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={pauseBriefly}
    >
      <ul className="category-circles-list" ref={list} aria-label="Categorias" onScroll={onScroll}>
        {items.map((category, index) => {
          const copy = looping ? Math.floor(index / categories.length) : 1;
          const clone = copy !== 1;
          const srcSet = categoryImageSrcSet(category.image);
          return (
            <li className="category-circles-item" key={`${copy}:${category.href}`} aria-hidden={clone || undefined}>
              <Link className="category-circles-link" href={category.href} prefetch={false} tabIndex={clone ? -1 : undefined}>
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

      {looping ? (
        <>
          <button
            type="button"
            className="category-circles-arrow category-circles-arrow-previous"
            aria-label="Categoria anterior"
            onClick={() => { pauseBriefly(); move(-1); }}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="category-circles-arrow category-circles-arrow-next"
            aria-label="Próxima categoria"
            onClick={() => { pauseBriefly(); move(1); }}
          >
            <ArrowRight aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  );
}
