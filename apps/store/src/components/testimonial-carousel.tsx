"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

export type TestimonialCardData = {
  id: string;
  name: string;
  comment: string;
  rating: number;
  avatar?: string;
  date?: string;
  productName?: string;
  productHref?: string;
  verified: boolean;
};

type TestimonialCarouselProps = {
  items: TestimonialCardData[];
  autoplay: boolean;
  autoplayInterval: number;
  desktopCards: number;
};

export function TestimonialCarousel({
  items,
  autoplay,
  autoplayInterval,
  desktopCards
}: TestimonialCarouselProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
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

  useEffect(() => {
    if (!autoplay || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) move(1);
    }, autoplayInterval);
    return () => window.clearInterval(timer);
  }, [autoplay, autoplayInterval, move, paused]);

  const style = { "--testimonial-columns": desktopCards } as CSSProperties;

  return (
    <div className="testimonial-carousel" style={style}>
      <div
        className="testimonial-carousel-viewport"
        ref={viewport}
        aria-label="Depoimentos de clientes"
        onPointerDown={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="testimonial-carousel-track">
          {items.map((item) => (
            <article className="testimonial-carousel-slide" key={item.id}>
              <div className="testimonial-card">
                <div className="testimonial-stars" aria-label={`${item.rating} de 5 estrelas`}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <Star aria-hidden="true" fill={index < item.rating ? "currentColor" : "none"} key={index} />
                  ))}
                </div>
                <blockquote>{item.comment}</blockquote>
                <footer>
                  {item.avatar ? (
                    <Image src={item.avatar} width={42} height={42} alt="" />
                  ) : (
                    <span className="testimonial-avatar" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <div>
                    <strong>{item.name}</strong>
                    {item.verified && <span className="verified-purchase"><BadgeCheck aria-hidden="true" /> Compra verificada</span>}
                    {item.date && <time dateTime={item.date}>{new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(item.date))}</time>}
                  </div>
                </footer>
                {item.productName && item.productHref && <Link href={item.productHref} prefetch={false} data-home-item={item.id}>Sobre {item.productName}</Link>}
              </div>
            </article>
          ))}
        </div>
      </div>
      {items.length > desktopCards && <div className="testimonial-carousel-controls" aria-label="Controles dos depoimentos">
        <button type="button" onClick={() => { setPaused(true); move(-1); }} aria-label="Depoimento anterior"><ArrowLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => { setPaused(true); move(1); }} aria-label="Próximo depoimento"><ArrowRight aria-hidden="true" /></button>
      </div>}
    </div>
  );
}
