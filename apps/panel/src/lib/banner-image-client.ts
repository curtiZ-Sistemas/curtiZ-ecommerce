/** Resize before upload; no server image service or new dependency is required. */
export async function optimizeBannerUpload(file: File, device: "desktop" | "mobile"): Promise<File> {
  if (typeof createImageBitmap !== "function" || file.size > 10 * 1024 * 1024) return file;
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("Não conseguimos ler essa imagem. Escolha outro arquivo PNG, JPEG ou WebP.");
  });
  try {
    const width = Math.min(image.width, device === "mobile" ? 860 : 2400);
    const height = Math.round(image.height * width / image.width);
    if (!width || !height || height > 6000) throw new Error("A imagem tem dimensões inadequadas para um banner.");
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .82));
    canvas.width = 0; canvas.height = 0;
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], "banner.webp", { type: "image/webp" });
  } finally { image.close(); }
}
