const unavailableProductImage = "/images/product-unavailable.svg";

export function applyProductImageFallback(image: HTMLImageElement) {
  if (image.dataset.fallbackApplied === "true") return;
  image.dataset.fallbackApplied = "true";
  image.removeAttribute("srcset");
  if (!image.src.endsWith(unavailableProductImage)) image.src = unavailableProductImage;
}
