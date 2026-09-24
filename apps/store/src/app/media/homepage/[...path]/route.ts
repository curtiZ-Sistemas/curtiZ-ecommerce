import { NextResponse } from "next/server";
import { isSafeHomepageImagePath } from "../../../../lib/homepage-media";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const protectedHeaders = {
  "x-robots-tag": "noindex, noimageindex",
  "x-content-type-options": "nosniff"
};

function unavailable(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { ...protectedHeaders, "cache-control": "private, no-store" }
  });
}

function configuredSupabaseOrigin(): string | null {
  try {
    const url = new URL(process.env.SUPABASE_URL ?? "");
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
      && process.env.APP_ENV !== "production";
    if ((url.protocol !== "https:" && !localHttp) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;
  if (!Array.isArray(segments) || segments.some((segment) =>
    !segment || segment === "." || segment === ".." || segment.includes("..") ||
    segment.includes("/") || segment.includes("\\") || /\p{Cc}/u.test(segment)
  ) || !isSafeHomepageImagePath(segments.join("/"))) {
    return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const origin = configuredSupabaseOrigin();
  if (!origin) return unavailable(503, "Homepage media unavailable");

  let upstream: Response;
  try {
    const encodedPath = segments.map(encodeURIComponent).join("/");
    upstream = await fetch(`${origin}/storage/v1/object/public/homepage-public/${encodedPath}`, { redirect: "manual" });
  } catch {
    return unavailable(502, "Homepage media unavailable");
  }
  if (!upstream.ok || upstream.status >= 300) return unavailable(upstream.status === 404 ? 404 : 502, "Homepage media unavailable");

  const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const contentLength = Number(upstream.headers.get("content-length"));
  if (!allowedImageTypes.has(contentType) || !Number.isSafeInteger(contentLength) || contentLength < 1) {
    return unavailable(502, "Homepage media unavailable");
  }
  if (contentLength > MAX_IMAGE_BYTES) return unavailable(413, "Homepage image too large");

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...protectedHeaders,
      "content-type": contentType,
      "content-length": String(contentLength),
      "cache-control": "public, max-age=86400, s-maxage=31536000, immutable",
      "content-disposition": "inline"
    }
  });
}
