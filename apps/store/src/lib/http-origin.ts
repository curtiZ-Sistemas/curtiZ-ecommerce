import { configuredPublicOrigins } from "@curtiz/config";

const configuredOrigins = () =>
  new Set(
    [
      ...configuredPublicOrigins(),
      ...(process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()),
      ...(process.env.APP_ENV === "production" ? [] : ["http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001"])
    ].filter((value): value is string => Boolean(value))
  );

export const isAllowedRequestOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin || configuredOrigins().has(origin);
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return ["GET", "HEAD", "OPTIONS"].includes(request.method)
    || request.headers.get("sec-fetch-site") === "same-origin";
};

export const corsHeadersFor = (request: Request): Record<string, string> => {
  const origin = request.headers.get("origin");
  return origin &&
    (origin === new URL(request.url).origin || configuredOrigins().has(origin))
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
        "access-control-allow-headers": "content-type, if-none-match",
        "access-control-expose-headers": "etag",
        vary: "Origin"
      }
    : {};
};
