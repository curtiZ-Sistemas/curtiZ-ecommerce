"use client";

import { formatBRL } from "@curtiz/domain";
import { Check, ChevronLeft, ChevronRight, Expand, Heart, ShoppingBag, Star, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductDetailData } from "@/lib/storefront-data";
import { useCart } from "./cart-provider";
import { useFavorites } from "./favorites-provider";

export function ProductPurchase({ detail }: { detail: ProductDetailData }) {
  const { product, variants, gallery } = detail;
  const availableVariants = useMemo(
    () => variants.filter((variant) => variant.stock > 0),
    [variants]
  );
  const initial = availableVariants[0] ?? variants[0];
  const [color, setColor] = useState(initial?.color ?? product.colors[0] ?? "");
  const [size, setSize] = useState(initial?.size ?? product.sizes[0] ?? "");
  const [selectedImage, setSelectedImage] = useState(
    initial?.image ?? gallery[0]?.src ?? product.image
  );
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const galleryTriggerRef = useRef<HTMLButtonElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const closeLightboxRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<number | null>(null);
  const { add } = useCart();
  const { hydrated, has, toggle } = useFavorites();
  const router = useRouter();

  const colors = [...new Set(variants.map((variant) => variant.color))];
  const sizes = [
    ...new Set(variants.filter((variant) => variant.color === color).map((variant) => variant.size))
  ];
  const selectedVariant =
    variants.find((variant) => variant.color === color && variant.size === size) ??
    variants.find((variant) => variant.color === color);
  const favorite = hydrated && has(product.id);
  const currentPrice = selectedVariant?.priceInCents ?? product.priceInCents;
  const currentStock = selectedVariant?.stock ?? 0;
  const images = useMemo(
    () =>
      [
        ...(selectedVariant?.image
          ? [{ id: `${selectedVariant.id}-variant`, src: selectedVariant.image, alt: product.name }]
          : []),
        ...gallery
      ].filter(
        (image, index, list) =>
          list.findIndex((candidate) => candidate.src === image.src) === index
      ),
    [gallery, product.name, selectedVariant?.id, selectedVariant?.image]
  );
  const activeImageIndex = Math.max(
    0,
    images.findIndex((image) => image.src === selectedImage)
  );

  const selectRelativeImage = useCallback(
    (offset: number) => {
      setSelectedImage((current) => {
        const currentIndex = Math.max(
          0,
          images.findIndex((image) => image.src === current)
        );
        const nextIndex = (currentIndex + offset + images.length) % images.length;
        return images[nextIndex]?.src ?? current;
      });
    },
    [images]
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    closeLightboxRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft" && images.length > 1) selectRelativeImage(-1);
      if (event.key === "ArrowRight" && images.length > 1) selectRelativeImage(1);
      if (event.key !== "Tab") return;
      const focusable = lightboxRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.setTimeout(() => galleryTriggerRef.current?.focus(), 0);
    };
  }, [images.length, lightboxOpen, selectRelativeImage]);

  const chooseColor = (nextColor: string) => {
    const nextVariant =
      variants.find(
        (variant) => variant.color === nextColor && variant.size === size && variant.stock > 0
      ) ??
      variants.find((variant) => variant.color === nextColor && variant.stock > 0) ??
      variants.find((variant) => variant.color === nextColor);
    setColor(nextColor);
    if (nextVariant) {
      setSize(nextVariant.size);
      setSelectedImage(nextVariant.image ?? gallery[0]?.src ?? product.image);
    }
  };

  const chooseSize = (nextSize: string) => {
    const nextVariant = variants.find(
      (variant) => variant.color === color && variant.size === nextSize
    );
    setSize(nextSize);
    if (nextVariant?.image) setSelectedImage(nextVariant.image);
  };

  const addSelected = () => {
    if (!selectedVariant || selectedVariant.stock <= 0 || busy) return false;
    add(product, selectedVariant.color, selectedVariant.size, {
      variantId: selectedVariant.id,
      unitPriceInCents: selectedVariant.priceInCents,
      stock: selectedVariant.stock,
      image: selectedVariant.image ?? product.image
    });
    setBusy(true);
    window.setTimeout(() => setBusy(false), 1_200);
    return true;
  };

  return (
    <section className="product-detail">
      <div className="product-gallery">
        {product.compareAtPriceInCents && <span className="gallery-offer">Oferta</span>}
        <div className="product-gallery-main">
          <button
            ref={galleryTriggerRef}
            className="product-gallery-trigger"
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label={`Ampliar imagem de ${product.name}`}
          >
            <Image
              src={selectedImage}
              alt={product.name}
              width={900}
              height={720}
              sizes="(max-width: 900px) 100vw, 58vw"
              loading="eager"
              priority
            />
            <span className="product-gallery-zoom-hint" aria-hidden="true">
              <Expand /> Ampliar
            </span>
          </button>
        </div>
        {images.length > 1 && (
          <div className="product-thumbnails" role="list" aria-label="Imagens do produto">
            {images.slice(0, 6).map((image) => (
              <button
                className={selectedImage === image.src ? "active" : ""}
                type="button"
                onClick={() => setSelectedImage(image.src)}
                aria-label={`Exibir ${image.alt}`}
                aria-pressed={selectedImage === image.src}
                role="listitem"
                key={image.id}
              >
                <Image src={image.src} alt="" width={86} height={68} />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightboxOpen && (
        <div
          ref={lightboxRef}
          className="product-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Visualização ampliada de ${product.name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLightboxOpen(false);
          }}
        >
          <button
            ref={closeLightboxRef}
            className="product-lightbox-close"
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Fechar imagem ampliada"
          >
            <X />
          </button>
          {images.length > 1 && (
            <button
              className="product-lightbox-navigation previous"
              type="button"
              onClick={() => selectRelativeImage(-1)}
              aria-label="Imagem anterior"
            >
              <ChevronLeft />
            </button>
          )}
          <div
            className="product-lightbox-image"
            onTouchStart={(event) => {
              touchStartRef.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = touchStartRef.current;
              const end = event.changedTouches[0]?.clientX;
              touchStartRef.current = null;
              if (start === null || end === undefined || Math.abs(end - start) < 48) return;
              selectRelativeImage(end < start ? 1 : -1);
            }}
          >
            <Image
              src={selectedImage}
              alt={`${product.name}, imagem ${activeImageIndex + 1} de ${images.length}`}
              fill
              sizes="90vw"
            />
          </div>
          {images.length > 1 && (
            <button
              className="product-lightbox-navigation next"
              type="button"
              onClick={() => selectRelativeImage(1)}
              aria-label="Próxima imagem"
            >
              <ChevronRight />
            </button>
          )}
          {images.length > 1 && (
            <span className="product-lightbox-counter" aria-live="polite">
              {activeImageIndex + 1} / {images.length}
            </span>
          )}
        </div>
      )}

      <div className="product-summary">
        <div className="product-summary-heading">
          <div>
            <p className="eyebrow">{product.category}</p>
            <h1>{product.name}</h1>
          </div>
          <button
            className={favorite ? "product-favorite active" : "product-favorite"}
            type="button"
            onClick={() => toggle(product)}
            aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-pressed={favorite}
          >
            <Heart fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
        {product.reviews > 0 && (
          <div className="rating">
            <Star fill="currentColor" />
            <strong>{product.rating.toLocaleString("pt-BR")}</strong>
            <span>({product.reviews.toLocaleString("pt-BR")} avaliações)</span>
          </div>
        )}
        <p className="product-description">{product.description}</p>
        <p className="product-price">
          <strong>{formatBRL(currentPrice)}</strong>
          {product.compareAtPriceInCents && <s>{formatBRL(product.compareAtPriceInCents)}</s>}
        </p>
        <span className="installments">ou em até 6x sem juros</span>

        <div className="product-options">
          <fieldset>
            <legend>Cor: {color}</legend>
            <div className="option-row color-options">
              {colors.map((item) => {
                const variant = variants.find((candidate) => candidate.color === item);
                return (
                  <button
                    className={item === color ? "option active" : "option"}
                    type="button"
                    onClick={() => chooseColor(item)}
                    aria-pressed={item === color}
                    key={item}
                  >
                    {variant?.colorHex && (
                      <i style={{ backgroundColor: variant.colorHex }} aria-hidden="true" />
                    )}
                    {item}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>Tamanho</legend>
            <div className="option-row">
              {sizes.map((item) => {
                const variant = variants.find(
                  (candidate) => candidate.color === color && candidate.size === item
                );
                return (
                  <button
                    className={item === size ? "option active" : "option"}
                    type="button"
                    onClick={() => chooseSize(item)}
                    disabled={!variant || variant.stock <= 0}
                    aria-pressed={item === size}
                    key={item}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {currentStock <= 0 && (
            <p className="product-stock unavailable">Indisponível nesta combinação</p>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {busy ? `${product.name} adicionado ao carrinho.` : ""}
          </p>
          <button
            className="primary-button full-button"
            type="button"
            onClick={addSelected}
            disabled={!selectedVariant || currentStock <= 0 || busy}
          >
            {busy ? <Check /> : <ShoppingBag />}
            {busy ? "Adicionado ao carrinho" : "Adicionar ao carrinho"}
          </button>
          <button
            className="secondary-button full-button buy-now-button"
            type="button"
            onClick={() => {
              if (addSelected()) router.push("/checkout?origem=comprar-agora");
            }}
            disabled={!selectedVariant || currentStock <= 0 || busy}
          >
            Comprar agora
          </button>
        </div>
      </div>
    </section>
  );
}
