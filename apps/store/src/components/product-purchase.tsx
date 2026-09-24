"use client";

import { formatBRL, storefrontItemKey, type Product } from "@curtiz/domain";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  PlayCircle,
  ShoppingBag,
  Star
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { ProductDetailData } from "@/lib/storefront-data";
import { productImageVariantUrl } from "@/lib/responsive-storefront-image";
import {
  galleryWindowStart,
  gallerySwipeDirection,
  initialProductSelection,
  mediaForColor,
  preferredColorImage,
  productDisplayTitleForColor,
  resolveProductColor
} from "@/lib/product-options";
import { useCart } from "./cart-provider";
import { useFavorites } from "./favorites-provider";
import { ColorSwatch } from "./color-swatch";
import { ProductImageViewer } from "./product-image-viewer";
import { rememberViewedProduct, trackIntelligence } from "../lib/intelligence-client";

export function ProductPurchase({
  detail,
  initialVariantId,
  initialColor
}: {
  detail: ProductDetailData;
  initialVariantId?: string;
  initialColor?: string;
}) {
  const { product, variants, gallery } = detail;
  const initialSelection = useMemo(
    () => initialProductSelection(variants, initialVariantId, initialColor),
    [initialVariantId, initialColor, variants]
  );
  const initialVariant = variants.find((variant) => variant.id === initialVariantId)
    ?? variants.find((variant) => variant.color === initialSelection.color && variant.size === initialSelection.size);
  const [color, setColor] = useState(initialSelection.color || product.colors[0] || "");
  const [size, setSize] = useState(initialSelection.size);
  const [selectedImage, setSelectedImage] = useState(
    preferredColorImage(detail.media, initialSelection.color, initialVariant?.id,
      initialVariant?.image ?? variants.find((item) => item.color === initialSelection.color)?.image,
      gallery[0]?.src ?? product.image)
  );
  const [thumbnailStart, setThumbnailStart] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const galleryTriggerRef = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressGalleryClick = useRef(false);
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
  const selectedDisplayTitle = productDisplayTitleForColor(variants, color, product.name);
  const currentPrice = selectedVariant?.priceInCents ?? product.priceInCents;
  const currentStock = selectedVariant?.stock;
  const favoriteProduct: Product = selectedVariant
    ? {
        ...product,
        storefrontKey: storefrontItemKey({ id: product.id, variantId: selectedVariant.id }),
        variantId: selectedVariant.id,
        ...(selectedVariant.sku ? { sku: selectedVariant.sku } : {}),
        variantColor: selectedVariant.color,
        variantSize: selectedVariant.size,
        name: product.name,
        ...(selectedVariant.displayTitle?.trim() ? { variantTitle: selectedVariant.displayTitle.trim() } : {}),
        image: selectedVariant.image ?? product.image,
        priceInCents: currentPrice,
        colors: [selectedVariant.color],
        sizes: [selectedVariant.size],
        stock: selectedVariant.stock
      }
    : product;
  const favorite = hydrated && has(favoriteProduct);
  const comparisonPrice =
    product.compareAtPriceInCents && product.compareAtPriceInCents > currentPrice
      ? product.compareAtPriceInCents
      : undefined;
  const discountPercentage = comparisonPrice
    ? Math.round(((comparisonPrice - currentPrice) / comparisonPrice) * 100)
    : 0;
  const images = useMemo(
    () => {
      const colorVariant = selectedVariant
        ?? variants.find((item) => item.id === initialVariantId && item.color === color)
        ?? variants.find((item) => item.color === color && item.image);
      const colorImage = colorVariant?.image ? {
        id: `${colorVariant.id}-variant`, src: colorVariant.image, alt: selectedDisplayTitle,
        type: "image" as const, mimeType: "image/webp"
      } : undefined;
      return [
        ...mediaForColor(detail.media, color, selectedVariant?.id, colorImage),
        ...(!detail.media.length ? gallery.map((item) => ({ ...item, type: "image" as const, mimeType: "image/webp" })) : []),
        ...(!detail.media.length ? [{ id: `${product.id}-fallback`, src: product.image, alt: product.name, type: "image" as const, mimeType: "image/webp" }] : [])
      ].filter(
        (image, index, list) => list.findIndex((candidate) => candidate.src === image.src) === index
      );
    },
    [detail.media, gallery, product.id, product.image, product.name, selectedDisplayTitle, color, variants, selectedVariant]
  );
  const selectedMedia = images.find((item) => item.src === selectedImage) ?? images[0];
  const selectedImageSource = selectedMedia?.src ?? selectedImage;
  const selectedImageSrcSet = [360, 540, 720, 1080]
    .map((width) => {
      const url = productImageVariantUrl(selectedImageSource, width);
      return url ? `${url} ${width}w` : null;
    })
    .filter((candidate): candidate is string => candidate !== null)
    .join(", ");
  const activeImageIndex = Math.max(0, images.findIndex((image) => image.src === selectedImage));
  const maximumThumbnailStart = Math.max(0, images.length - 3);
  const preserveVariantInUrl = (variantId?: string, selectedColor = color) => {
    router.replace(
      `/produto/${encodeURIComponent(product.slug)}?${variantId ? `variant=${encodeURIComponent(variantId)}&` : ""}color=${encodeURIComponent(selectedColor)}`,
      { scroll: false }
    );
  };

  useEffect(() => {
    if (selectedMedia && selectedImage !== selectedMedia.src) setSelectedImage(selectedMedia.src);
  }, [selectedImage, selectedMedia]);

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
  const startGallerySwipe = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse") return;
    suppressGalleryClick.current = false;
    swipeStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const endGallerySwipe = (event: PointerEvent<HTMLButtonElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.id !== event.pointerId) return;
    const horizontal = event.clientX - start.x;
    const vertical = event.clientY - start.y;
    const direction = gallerySwipeDirection(horizontal, vertical);
    if (!direction) return;
    suppressGalleryClick.current = true;
    if (direction === 1) selectNextImage();
    else selectPreviousImage();
  };

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
    setSelectedImage(preferredColorImage(detail.media, nextColor, imageVariant?.id, imageVariant?.image, product.image));
    preserveVariantInUrl(retainedSize?.id ?? (nextSize ? imageVariant?.id : undefined), nextColor);
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
    setSelectedImage(preferredColorImage(detail.media, color, nextVariant?.id, nextVariant?.image, product.image));
    preserveVariantInUrl(nextVariant?.id);
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
          {selectedMedia?.type === "video" ? (
            <video
              className="product-gallery-video"
              controls
              playsInline
              preload="none"
              poster={selectedMedia.poster}
              aria-label={selectedMedia.alt}
              onPlay={() => trackIntelligence({ type: "image_interaction", productId: product.id })}
            >
              <source src={selectedMedia.src} type={selectedMedia.mimeType} />
              Seu navegador não reproduz este vídeo.
            </video>
          ) : <button
            ref={galleryTriggerRef}
            className="product-gallery-trigger"
            type="button"
            onClick={() => {
              if (suppressGalleryClick.current) { suppressGalleryClick.current = false; return; }
              setLightboxOpen(true);
            }}
            onPointerDown={startGallerySwipe}
            onPointerUp={(event) => { endGallerySwipe(event); trackIntelligence({ type: "image_interaction", productId: product.id }); }}
            onPointerCancel={() => { swipeStart.current = null; }}
            aria-label={`Abrir visualização de ${selectedDisplayTitle}`}
          >
            <picture>
              {selectedImageSrcSet ? (
                <source
                  type="image/webp"
                  srcSet={selectedImageSrcSet}
                  sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1024px) 52vw, 560px"
                />
              ) : null}
              <Image
                src={selectedImageSource}
                alt={`${selectedDisplayTitle} da curti Z`}
                width={760}
                height={620}
                sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1024px) 52vw, 560px"
                loading="eager"
                priority
              />
            </picture>
          </button>}
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
                    className={selectedMedia?.src === image.src ? "active" : ""}
                    data-visible-desktop={inDesktopWindow}
                    type="button"
                    onClick={() => setSelectedImage(image.src)}
                    aria-label={`Exibir ${image.alt}, imagem ${index + 1} de ${images.length}`}
                    aria-pressed={selectedMedia?.src === image.src}
                    role="listitem"
                    key={image.id}
                  >
                    {image.type === "video" ? (
                      <span className="product-video-thumbnail">
                        {image.poster ? <Image src={productImageVariantUrl(image.poster, 360) ?? image.poster} alt="" width={112} height={88} sizes="112px" /> : null}
                        <PlayCircle aria-hidden="true" />
                      </span>
                    ) : <Image src={productImageVariantUrl(image.src, 360) ?? image.src} alt="" width={112} height={88} sizes="112px" />}
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

      {lightboxOpen && selectedMedia?.type !== "video" ? (
        <ProductImageViewer
          src={selectedMedia?.src ?? selectedImage}
          alt={`${selectedDisplayTitle} da curti Z`}
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
            <h1>{selectedDisplayTitle}</h1>
          </div>
          <button
            className={favorite ? "product-favorite active" : "product-favorite"}
            type="button"
            onClick={() => toggle(favoriteProduct)}
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
                const colorHexSecondary = colorVariants.find(
                  (variant) => variant.colorHexSecondary
                )?.colorHexSecondary;
                return (
                  <button
                    className={item === color ? "color-swatch selected" : "color-swatch"}
                    type="button"
                    onClick={() => chooseColor(item)}
                    disabled={!available}
                    aria-label={`${item}${available ? "" : ", indisponível"}`}
                    aria-pressed={item === color}
                    title={item}
                    key={item}
                  >
                    <ColorSwatch
                      className="product-option-color-preview"
                      name={item}
                      primaryColor={resolveProductColor(item, colorHex)}
                      secondaryColor={colorHexSecondary}
                      decorative
                    />
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
            {added ? `${selectedDisplayTitle} adicionado ao carrinho.` : ""}
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
