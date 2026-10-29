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

// Cinco cópias da lista: a do meio é a real; as laterais dão folga para deslizes rápidos
// no celular nunca chegarem ao fim físico antes de a posição ser reajustada.
const COPIES = 5;
const MIDDLE = Math.floor(COPIES / 2);

function jumpTo(node: HTMLElement, left: number) {
  node.scrollTo({ left, behavior: "instant" });
}

export function CategoryCarousel({ categories }: CategoryCarouselProps) {
  const list = useRef<HTMLUListElement>(null);
  const setWidth = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const hovered = useRef(false);
  const positioned = useRef(false);
  const [looping, setLooping] = useState(true);
  const [paused, setPaused] = useState(false);

  // Distância exata (com subpixel) entre o início de um item e o do seguinte.
  const itemStep = useCallback(() => {
    const node = list.current;
    const first = node?.children.item(0);
    const second = node?.children.item(1);
    if (!(first instanceof HTMLElement)) return 0;
    if (second instanceof HTMLElement) return second.getBoundingClientRect().left - first.getBoundingClientRect().left;
    return first.getBoundingClientRect().width;
  }, []);

  // Largura de uma cópia; se a lista inteira cabe na tela, não há loop.
  const measure = useCallback(() => {
    const node = list.current;
    if (!node || categories.length === 0) return;
    const looped = node.children.length === categories.length * COPIES;
    const first = node.children.item(0);
    const nextCopy = looped ? node.children.item(categories.length) : null;
    const width = first instanceof HTMLElement && nextCopy instanceof HTMLElement
      ? nextCopy.getBoundingClientRect().left - first.getBoundingClientRect().left
      : categories.length * itemStep();
    if (width <= 0) return;
    const previous = setWidth.current;
    setWidth.current = width;
    const shouldLoop = categories.length > 1 && width > node.clientWidth;
    setLooping(shouldLoop);
    if (!shouldLoop) {
      positioned.current = false;
      return;
    }
    if (!looped) return;
    if (!positioned.current) {
      positioned.current = true;
      jumpTo(node, width * MIDDLE);
    } else if (previous > 0 && Math.abs(previous - width) > 0.5) {
      jumpTo(node, (node.scrollLeft / previous) * width);
    }
  }, [categories.length, itemStep]);

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

  // Ao terminar a rolagem, volta para a posição equivalente na cópia do meio. As cópias são
  // idênticas, então o salto é invisível.
  const recenter = useCallback(() => {
    const node = list.current;
    const width = setWidth.current;
    if (!node || width <= 0 || !looping) return;
    const base = width * MIDDLE;
    const offset = node.scrollLeft - base;
    if (Math.abs(offset) < width / 2) return;
    const wrapped = ((((offset + width / 2) % width) + width) % width) - width / 2;
    jumpTo(node, base + wrapped);
  }, [looping]);

  const scheduleRecenter = useCallback(() => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      recenter();
    }, 160);
  }, [recenter]);

  // `scrollend` avisa o fim real da rolagem (inclusive da inércia do dedo); o temporizador cobre
  // navegadores que ainda não o disparam.
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const onScrollEnd = () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
      recenter();
    };
    node.addEventListener("scrollend", onScrollEnd);
    return () => node.removeEventListener("scrollend", onScrollEnd);
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
    const step = itemStep();
    if (!node || step <= 0) return;
    recenter();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Alinha ao início do item mais próximo para o passo nunca acumular desvio.
    const target = (Math.round(node.scrollLeft / step) + direction) * step;
    node.scrollTo({ left: target, behavior: reducedMotion ? "instant" : "smooth" });
  }, [itemStep, recenter]);

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
      <ul className="category-circles-list" ref={list} aria-label="Categorias" onScroll={scheduleRecenter}>
        {items.map((category, index) => {
          const copy = looping ? Math.floor(index / categories.length) : MIDDLE;
          const clone = copy !== MIDDLE;
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
