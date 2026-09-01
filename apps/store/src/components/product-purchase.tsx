"use client";

import { formatBRL } from "@curtiz/domain";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ShoppingBag,
  Star
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ProductDetailData } from "@/lib/storefront-data";
import {
  galleryWindowStart,
  initialProductSelection,
  resolveProductColor
} from "@/lib/product-options";
import { useCart } from "./cart-provider";
import { useFavorites } from "./favorites-provider";
import { ProductImageViewer } from "./product-image-viewer";
import { rememberViewedProduct, trackIntelligence } from "../lib/intelligence-client";

export function ProductPurchase({
  detail,
  initialVariantId
}: {
  detail: ProductDetailData;
  initialVariantId?: string;
}) {
  const { product, variants, gallery } = detail;
  const initialSelection = useMemo(
    () => initialProductSelection(variants, initialVariantId),
    [initialVariantId, variants]
  );
  const initialVariant = variants.find(
    (variant) => variant.color === initialSelection.color && variant.size === initialSelection.size
  );
  const [color, setColor] = useState(initialSelection.color || product.colors[0] || "");
  const [size, setSize] = useState(initialSelection.size);
  const [selectedImage, setSelectedImage] = useState(
    initialVariant?.image ?? gallery[0]?.src ?? variants[0]?.image ?? product.image
  );
  const [thumbnailStart, setThumbnailStart] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const galleryTriggerRef = useRef<HTMLButtonElement>(null);
  const { add } = useCart();
  const { hydrated, has, toggle } = useFavorites();
  const router = useRouter();

  useEffect(() => {
    rememberViewedProduct(product.id);
    trackIntelligence({ type: "product_view", productId: product.id });
  }, [product.id]);

  const colors = useMemo(() => [...new Set(variants.map((variant) => variant.color))], [variants]);
  const sizes = useMemo(
    () => [...new Set(variants.filter((variant) => variant.color === color).map((variant) => variant.size))],
    [color, variants]
  );
  const selectedVariant = variants.find(
    (variant) => variant.color === color && variant.size === size
  );
  const favorite = hydrated && has(product.id);
  const currentPrice = selectedVariant?.priceInCents ?? product.priceInCents;
  const currentStock = selectedVariant?.stock;
  const comparisonPrice =
    product.compareAtPriceInCents && product.compareAtPriceInCents > currentPrice
      ? product.compareAtPriceInCents
      : undefined;
  const discountPercentage = comparisonPrice
    ? Math.round(((comparisonPrice - currentPrice) / comparisonPrice) * 100)
    : 0;
  const images = useMemo(
    () =>
      [
        ...(selectedVariant?.image
          ? [{ id: `${selectedVariant.id}-variant`, src: selectedVariant.image, alt: product.name }]
          : []),
        ...gallery,
        { id: `${product.id}-fallback`, src: product.image, alt: product.name }
      ].filter(
        (image, index, list) => list.findIndex((candidate) => candidate.src === image.src) === index
      ),
    [gallery, product.id, product.image, product.name, selectedVariant?.id, selectedVariant?.image]
  );
  const activeImageIndex = Math.max(0, images.findIndex((image) => image.src === selectedImage));
  const maximumThumbnailStart = Math.max(0, images.length - 3);

  useEffect(() => {
    setThumbnailStart((current) => {
      if (activeImageIndex < current) return activeImageIndex;
      if (activeImageIndex > current + 2) {
        return galleryWindowStart(images.length, activeImageIndex - 2);
      }
      return galleryWindowStart(images.length, current);
    });
  }, [activeImageIndex, images.length]);

  const selectRelativeImage = useCallback(
    (offset: number) => {
      setSelectedImage((current) => {
        const currentIndex = Math.max(0, images.findIndex((image) => image.src === current));
        const nextIndex = (currentIndex + offset + images.length) % images.length;
        return images[nextIndex]?.src ?? current;
      });
    },
    [images]
  );
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const selectPreviousImage = useCallback(() => selectRelativeImage(-1), [selectRelativeImage]);
  const selectNextImage = useCallback(() => selectRelativeImage(1), [selectRelativeImage]);

  const chooseColor = (nextColor: string) => {
    const colorVariants = variants.filter((variant) => variant.color === nextColor);
    const retainedSize = colorVariants.find(
      (variant) => variant.size === size && variant.stock > 0
    );
    const available = colorVariants.filter((variant) => variant.stock > 0);
    const availableSizes = [...new Set(available.map((variant) => variant.size))];
    const imageVariant = retainedSize ?? available.find((variant) => variant.image) ?? colorVariants[0];
    const nextSize = retainedSize?.size ?? (availableSizes.length === 1 ? availableSizes[0] ?? "" : "");
    setColor(nextColor);
    setSize(nextSize);
    setAdded(false);
    if (imageVariant?.image) setSelectedImage(imageVariant.image);
    trackIntelligence({
      type: "variant_select",
      productId: product.id,
      variantId: retainedSize?.id
    });
  };

  const chooseSize = (nextSize: string) => {
    const nextVariant = variants.find(
      (variant) => variant.color === color && variant.size === nextSize
    );
    setSize(nextSize);
    setAdded(false);
    trackIntelligence({
      type: "variant_select",
      productId: product.id,
      variantId: nextVariant?.id
    });
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
    window.setTimeout(() => setBusy(false), 1_000);
    return true;
  };

  return (
    <section className="product-detail">
      <div className="product-gallery">
        {discountPercentage > 0 ? <span className="gallery-offer">-{discountPercentage}%</span> : null}
        <div className="product-gallery-main">
          <button
            ref={galleryTriggerRef}
            className="product-gallery-trigger"
            type="button"
            onClick={() => setLightboxOpen(true)}
            onPointerUp={() => trackIntelligence({ type: "image_interaction", productId: product.id })}
            aria-label={`Abrir visualização de ${product.name}`}
          >
            <Image
              src={selectedImage}
              alt={`${product.name} da curti Z`}
              width={760}
              height={620}
              sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1024px) 52vw, 560px"
              loading="eager"
              priority
            />
          </button>
        </div>
        {images.length > 1 ? (
          <div className="product-thumbnail-navigation">
            {thumbnailStart > 0 ? (
              <button
                className="product-thumbnail-arrow previous"
                type="button"
                onClick={() => setThumbnailStart((current) => galleryWindowStart(images.length, current - 1))}
                aria-label="Mostrar miniaturas anteriores"
              >
                <ChevronLeft />
              </button>
            ) : null}
            <div className="product-thumbnails" role="list" aria-label="Imagens do produto">
              {images.map((image, index) => {
                const inDesktopWindow = index >= thumbnailStart && index < thumbnailStart + 3;
                return (
                  <button
                    className={selectedImage === image.src ? "active" : ""}
                    data-visible-desktop={inDesktopWindow}
                    type="button"
                    onClick={() => setSelectedImage(image.src)}
                    aria-label={`Exibir ${image.alt}, imagem ${index + 1} de ${images.length}`}
                    aria-pressed={selectedImage === image.src}
                    role="listitem"
                    key={image.id}
                  >
                    <Image src={image.src} alt="" width={112} height={88} sizes="112px" />
                  </button>
                );
              })}
            </div>
            {thumbnailStart < maximumThumbnailStart ? (
              <button
                className="product-thumbnail-arrow next"
                type="button"
                onClick={() => setThumbnailStart((current) => galleryWindowStart(images.length, current + 1))}
                aria-label="Mostrar próximas miniaturas"
              >
                <ChevronRight />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {lightboxOpen ? (
        <ProductImageViewer
          src={selectedImage}
          alt={`${product.name} da curti Z`}
          imageIndex={activeImageIndex}
          imageCount={images.length}
          onClose={closeLightbox}
          onPrevious={selectPreviousImage}
          onNext={selectNextImage}
          returnFocusRef={galleryTriggerRef}
        />
      ) : null}

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
        {product.reviews > 0 ? (
          <div className="rating product-rating">
            <Star fill="currentColor" />
            <strong>{product.rating.toLocaleString("pt-BR")}</strong>
            <span>{product.reviews.toLocaleString("pt-BR")} avaliações</span>
          </div>
        ) : null}

        <div className="product-pricing">
          {comparisonPrice ? <s>{formatBRL(comparisonPrice)}</s> : null}
          <div>
            <strong>{formatBRL(currentPrice)}</strong>
            {discountPercentage > 0 ? <span>{discountPercentage}% de desconto</span> : null}
          </div>
          <small>ou em até 6x de {formatBRL(Math.ceil(currentPrice / 6))} sem juros</small>
        </div>

        <div className="product-options">
          <fieldset>
            <legend>Cor <strong>{color}</strong></legend>
            <div className="option-row color-options">
              {colors.map((item) => {
                const colorVariants = variants.filter((candidate) => candidate.color === item);
                const available = colorVariants.some((variant) => variant.stock > 0);
                const colorHex = colorVariants.find((variant) => variant.colorHex)?.colorHex;
                return (
                  <button
                    className={item === color ? "color-swatch selected" : "color-swatch"}
                    style={{ "--swatch-color": resolveProductColor(item, colorHex) } as CSSProperties}
                    type="button"
                    onClick={() => chooseColor(item)}
                    disabled={!available}
                    aria-label={`${item}${available ? "" : ", indisponível"}`}
                    aria-pressed={item === color}
                    title={item}
                    key={item}
                  >
                    <span aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>Tamanho {size ? <strong>{size}</strong> : null}</legend>
            <div className="option-row size-options">
              {sizes.map((item) => {
                const variant = variants.find(
                  (candidate) => candidate.color === color && candidate.size === item
                );
                return (
                  <button
                    className={item === size ? "option selected" : "option"}
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
          {!selectedVariant && variants.some((variant) => variant.color === color && variant.stock > 0) ? (
            <p className="product-selection-hint">Escolha um tamanho para continuar.</p>
          ) : null}
          {selectedVariant && currentStock !== undefined ? (
            <p className={currentStock > 0 ? "product-stock available" : "product-stock unavailable"}>
              {currentStock > 0 ? "Em estoque" : "Indisponível nesta combinação"}
            </p>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite">
            {added ? `${product.name} adicionado ao carrinho.` : ""}
          </p>
          <button
            className="primary-button full-button buy-now-button"
            type="button"
            onClick={() => {
              if (!addSelected()) return;
              trackIntelligence({ type: "checkout_start", productId: product.id, variantId: selectedVariant?.id });
              router.push("/checkout?origem=comprar-agora");
            }}
            disabled={!selectedVariant || currentStock === undefined || currentStock <= 0 || busy}
          >
            Comprar agora
          </button>
          <button
            className="secondary-button full-button add-to-cart-button"
            type="button"
            onClick={() => {
              if (!addSelected()) return;
              setAdded(true);
            }}
            disabled={!selectedVariant || currentStock === undefined || currentStock <= 0 || busy}
          >
            {added ? <Check /> : <ShoppingBag />}
            {added ? "Adicionado ao carrinho" : "Adicionar ao carrinho"}
          </button>
        </div>
      </div>
    </section>
  );
}
