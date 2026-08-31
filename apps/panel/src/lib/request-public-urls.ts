import { resolvePublicAppUrls, type PublicAppUrls } from "@curtiz/config";
import { headers } from "next/headers";

export async function requestPublicAppUrls(): Promise<PublicAppUrls> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");

  return resolvePublicAppUrls(host ? `${protocol}://${host}` : undefined);
}
