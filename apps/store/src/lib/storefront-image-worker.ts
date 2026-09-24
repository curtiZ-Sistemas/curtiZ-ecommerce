import { isSafeBannerStoragePath } from "./banner-media";
import { isSafeHomepageImagePath } from "./homepage-media";

type ImageInfo = { width?: number; height?: number };
type TransformedImage = {
  response(options?: { headers?: HeadersInit }): Response;
};
type ImageTransform = {
  output(options: { format: "image/webp"; quality: number; anim: false }): Promise<TransformedImage>;
};
type ImageInput = {
  transform(options: { width: number }): ImageTransform;
};
type ImagesBinding = {
  info(stream: ReadableStream<Uint8Array>): Promise<ImageInfo>;
  input(stream: ReadableStream<Uint8Array>): ImageInput;
};
type ImageCache = Pick<Cache, "match" | "put">;
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
export type StorefrontImageEnvironment = { IMAGES: ImagesBinding; SUPABASE_URL: string; APP_ENV?: string };
type ImageEnvironment = StorefrontImageEnvironment;

type MediaSource = {
  bucket: "catalog-public" | "homepage-public";
  path: string;
  kind: "banner" | "homepage" | "product" | "category";
  widths: ReadonlySet<number>;
  immutable: boolean;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedImageTypes = new Set(["image/avif", "image/jpeg", "image/png", "image/webp"]);
const bannerWidths = new Set([360, 540, 720, 941, 1080, 1200, 1600]);
const homepageWidths = new Set([180, 360, 540, 720, 1080]);
const productWidths = new Set([180, 360, 540, 720, 1080]);
const categoryWidths = new Set([180, 360, 540]);
const safeProductSegment = /^[a-z0-9][a-z0-9._-]{0,199}$/iu;
const safeCategorySegment = /^[a-z0-9][a-z0-9._-]{0,199}$/iu;
const importedProductPath = /^products\/imports\/[0-9a-f-]{36}\/[a-f0-9]{64}\.webp$/iu;

function safeProductPath(path: string): boolean {
  const segments = path.split("/");
  return segments.length >= 3 && segments.length <= 8 && segments[0] === "products" &&
    segments.every((segment) => segment && segment !== "." && segment !== ".." &&
      !segment.includes("..") && safeProductSegment.test(segment)) &&
    /\.(?:avif|jpe?g|png|webp)$/iu.test(segments.at(-1) ?? "");
}

function safeCategoryPath(path: string): boolean {
  const segments = path.split("/");
  return segments.length >= 2 && segments.length <= 8 && segments[0] === "categories" &&
    segments.every((segment) => segment && segment !== "." && segment !== ".." &&
      !segment.includes("..") && safeCategorySegment.test(segment)) &&
    /\.(?:avif|jpe?g|png|webp)$/iu.test(segments.at(-1) ?? "");
}

function readSource(requestUrl: URL): MediaSource | null {
  const routes: Array<{ prefix: string; kind: MediaSource["kind"] }> = [
    { prefix: "/media/banner/", kind: "banner" },
    { prefix: "/media/homepage/", kind: "homepage" },
    { prefix: "/media/product/", kind: "product" },
    { prefix: "/media/category/", kind: "category" }
  ];
  const route = routes.find(({ prefix }) => requestUrl.pathname.startsWith(prefix));
  if (!route) return null;

  let path: string;
  try {
    path = decodeURIComponent(requestUrl.pathname.slice(route.prefix.length));
  } catch {
    return { kind: route.kind, bucket: "catalog-public", path: "", widths: new Set(), immutable: false };
  }
  if (path.split("/").some((segment) =>
    !segment || segment === "." || segment === ".." || segment.includes("..") ||
    segment.includes("\\") || /\p{Cc}/u.test(segment)
  )) return { kind: route.kind, bucket: "catalog-public", path: "", widths: new Set(), immutable: false };

  if (route.kind === "banner") {
    return isSafeBannerStoragePath(path)
      ? { kind: "banner", bucket: "catalog-public", path, widths: bannerWidths, immutable: true }
      : { kind: "banner", bucket: "catalog-public", path: "", widths: new Set(), immutable: false };
  }
  if (route.kind === "homepage") {
    return isSafeHomepageImagePath(path)
      ? { kind: "homepage", bucket: "homepage-public", path, widths: homepageWidths, immutable: true }
      : { kind: "homepage", bucket: "homepage-public", path: "", widths: new Set(), immutable: false };
  }
  if (route.kind === "category") {
    return safeCategoryPath(path)
      ? { kind: "category", bucket: "catalog-public", path, widths: categoryWidths, immutable: false }
      : { kind: "category", bucket: "catalog-public", path: "", widths: new Set(), immutable: false };
  }
  return safeProductPath(path)
    ? { kind: "product", bucket: "catalog-public", path, widths: productWidths, immutable: importedProductPath.test(path) }
    : { kind: "product", bucket: "catalog-public", path: "", widths: new Set(), immutable: false };
}

function responseForError(status: number, message: string, kind: MediaSource["kind"]) {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff"
  });
  if (kind === "banner" || kind === "homepage") headers.set("x-robots-tag", "noindex, noimageindex");
  return new Response(message, { status, headers });
}

function storageOrigin(env: ImageEnvironment): string | null {
  try {
    const url = new URL(env.SUPABASE_URL);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && env.APP_ENV !== "production";
    if ((url.protocol !== "https:" && !localHttp) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sourceUrl(origin: string, bucket: MediaSource["bucket"], path: string) {
  return `${origin}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function readUpstream(url: string, fetcher: typeof fetch) {
  let response: Response;
  try {
    response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  } catch {
    return { response: null, error: responseForError(502, "Image unavailable", "product") };
  }
  return { response, error: null };
}

function cacheControl(source: MediaSource) {
  return source.immutable
    ? "public, max-age=31536000, s-maxage=31536000, immutable"
    : "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
}

export async function optimizeStorefrontImageRequest(
  request: Request,
  env: ImageEnvironment,
  cache: ImageCache,
  context: WorkerContext,
  fetcher: typeof fetch = fetch
): Promise<Response | null> {
  const requestUrl = new URL(request.url);
  const source = readSource(requestUrl);
  if (!source) return null;
  if (!requestUrl.searchParams.has("w")) return null;
  if (!source.path) return responseForError(404, "Not found", source.kind);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return responseForError(405, "Method not allowed", source.kind);
  }
  if ([...requestUrl.searchParams.keys()].length !== 1 || !requestUrl.searchParams.has("w")) {
    return responseForError(400, "Invalid image width", source.kind);
  }
  const width = Number(requestUrl.searchParams.get("w"));
  if (!Number.isInteger(width) || !source.widths.has(width)) {
    return responseForError(400, "Invalid image width", source.kind);
  }

  const cacheKey = new Request(`${requestUrl.origin}${requestUrl.pathname}?w=${width}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (error) {
    console.warn(JSON.stringify({ event: "storefront_image_cache_read_failed", name: error instanceof Error ? error.name : "unknown" }));
  }

  const origin = storageOrigin(env);
  if (!origin) return responseForError(503, "Image unavailable", source.kind);

  let upstream: Response | null = null;
  let precomputedVariant = false;
  if (source.kind === "product" && importedProductPath.test(source.path)) {
    const variantPath = source.path.replace(/\.webp$/iu, `.${width}.webp`);
    const variant = await readUpstream(sourceUrl(origin, source.bucket, variantPath), fetcher);
    if (variant.error) return responseForError(502, "Image unavailable", source.kind);
    if (variant.response?.ok) {
      const type = variant.response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "image/webp") return responseForError(502, "Invalid image", source.kind);
      upstream = variant.response;
      precomputedVariant = true;
    } else if (variant.response?.status !== 404) {
      return responseForError(502, "Image unavailable", source.kind);
    }
  }

  if (!upstream) {
    const result = await readUpstream(sourceUrl(origin, source.bucket, source.path), fetcher);
    if (result.error) return responseForError(502, "Image unavailable", source.kind);
    if (!result.response?.ok || result.response.status >= 300) {
      return responseForError(result.response?.status === 404 ? 404 : 502, "Image unavailable", source.kind);
    }
    upstream = result.response;
  }

  const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLength = Number(upstream.headers.get("content-length"));
  if (!allowedImageTypes.has(contentType) || !Number.isSafeInteger(contentLength) || contentLength < 1) {
    return responseForError(502, "Invalid image", source.kind);
  }
  if (contentLength > MAX_IMAGE_BYTES) return responseForError(413, "Image too large", source.kind);
  if (!upstream.body) return responseForError(502, "Image unavailable", source.kind);

  let imageResponse: Response;
  if (precomputedVariant) {
    imageResponse = new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "image/webp" }
    });
  } else {
    const [infoStream, imageStream] = upstream.body.tee();
    let info: ImageInfo;
    try {
      info = await env.IMAGES.info(infoStream);
      const sourceWidth = Number(info.width);
      if (!Number.isInteger(sourceWidth) || sourceWidth < 1) throw new Error("Invalid image dimensions");
      const output = await env.IMAGES.input(imageStream)
        .transform({ width: Math.min(width, sourceWidth) })
        .output({ format: "image/webp", quality: source.kind === "banner" ? 82 : 80, anim: false });
      imageResponse = output.response({ headers: { "cache-control": cacheControl(source) } });
    } catch (error) {
      console.error(JSON.stringify({ event: "storefront_image_transform_failed", kind: source.kind, name: error instanceof Error ? error.name : "unknown" }));
      return responseForError(502, "Image unavailable", source.kind);
    }
  }

  const headers = new Headers(imageResponse.headers);
  headers.set("content-type", "image/webp");
  headers.set("cache-control", cacheControl(source));
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", "inline");
  if (source.kind === "banner" || source.kind === "homepage") headers.set("x-robots-tag", "noindex, noimageindex");
  const response = new Response(imageResponse.body, { status: 200, headers });
  context.waitUntil(cache.put(cacheKey, response.clone()).catch((error) => {
    console.warn(JSON.stringify({ event: "storefront_image_cache_write_failed", name: error instanceof Error ? error.name : "unknown" }));
  }));
  return request.method === "HEAD" ? new Response(null, { status: 200, headers }) : response;
}
