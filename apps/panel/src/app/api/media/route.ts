import { NextResponse } from "next/server";

/** Public catalog media only. Private files use their authenticated download routes. */
export async function GET(request: Request) {
  const fail = (status: number) => NextResponse.json({ ok: false, message: "Mídia indisponível." }, {
    status, headers: { "cache-control": "no-store" }
  });
  try {
    const query = new URL(request.url).searchParams;
    const bucket = query.get("bucket");
    let path = query.get("path") ?? "";
    if (bucket !== "catalog-public" && bucket !== "homepage-public") return fail(400);
    const origin = new URL(process.env.SUPABASE_URL ?? "");
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
      || (origin.protocol !== "https:" && !(process.env.APP_ENV !== "production" && origin.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(origin.hostname)))) return fail(503);
    const prefix = `/storage/v1/object/public/${bucket}/`;
    if (path.startsWith("https://")) {
      const source = new URL(path);
      if (source.origin !== origin.origin || !source.pathname.startsWith(prefix) || source.search || source.hash) return fail(400);
      path = decodeURIComponent(source.pathname.slice(prefix.length));
    }
    path = path.replace(new RegExp(`^${bucket}/`, "u"), "");
    if (!path || path.length > 2048 || path.includes("\\")
      || Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) return fail(400);
    const source = new URL(prefix + path.split("/").map(encodeURIComponent).join("/"), origin);
    let media: Response;
    try {
      media = await fetch(source, { redirect: "error" });
    } catch {
      // Public banner images can load from Storage in the browser even if the Worker cannot reach it.
      if (bucket === "catalog-public" && /^banners\/.+\.(?:jpe?g|png|webp|avif|gif)$/iu.test(path)) {
        return NextResponse.redirect(source, { status: 307, headers: {
          "cache-control": "no-store", "referrer-policy": "no-referrer"
        } });
      }
      return fail(503);
    }
    const contentType = media.headers.get("content-type")?.split(";")[0] ?? "";
    if (!media.ok || !/^(image\/(jpeg|png|webp|avif|gif)|video\/(mp4|webm))$/u.test(contentType)) {
      await media.body?.cancel();
      return fail(404);
    }
    return new NextResponse(media.body, { headers: {
      "content-type": contentType, "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox"
    } });
  } catch { return fail(503); }
}
