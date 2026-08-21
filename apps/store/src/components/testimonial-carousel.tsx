"use client";

import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight, BadgeCheck, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef } from "react";

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
  const autoplayPlugin = useRef(
    Autoplay({
      delay: autoplayInterval,
      stopOnInteraction: true,
      stopOnMouseEnter: true
    })
  );
  const [viewportRef, api] = useEmblaCarousel(
    { align: "start", containScroll: "trimSnaps", loop: items.length > desktopCards },
    autoplay ? [autoplayPlugin.current] : []
  );

  useEffect(() => {
    if (!autoplay || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      autoplayPlugin.current.stop();
    }
  }, [autoplay]);

  const style = { "--testimonial-columns": desktopCards } as CSSProperties;

  return (
    <div className="testimonial-carousel" style={style}>
      <div className="testimonial-carousel-viewport" ref={viewportRef} aria-label="Depoimentos de clientes">
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
                {item.productName && item.productHref && <Link href={item.productHref} data-home-item={item.id}>Sobre {item.productName}</Link>}
              </div>
            </article>
          ))}
        </div>
      </div>
      {items.length > desktopCards && <div className="testimonial-carousel-controls" aria-label="Controles dos depoimentos">
        <button type="button" onClick={() => api?.scrollPrev()} aria-label="Depoimento anterior"><ArrowLeft aria-hidden="true" /></button>
        <button type="button" onClick={() => api?.scrollNext()} aria-label="Próximo depoimento"><ArrowRight aria-hidden="true" /></button>
      </div>}
    </div>
  );
}
