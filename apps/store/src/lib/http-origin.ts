const configuredOrigins = () =>
  new Set(
    [
      process.env.NEXT_PUBLIC_STORE_URL,
      process.env.NEXT_PUBLIC_PANEL_URL,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001"
    ].filter((value): value is string => Boolean(value))
  );

export const isAllowedRequestOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || configuredOrigins().has(origin);
};

export const corsHeadersFor = (request: Request): Record<string, string> => {
  const origin = request.headers.get("origin");
  return origin && configuredOrigins().has(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "Origin"
      }
    : {};
};
