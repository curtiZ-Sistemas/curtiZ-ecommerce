import { headers } from "next/headers";
import { serializeJsonLd } from "../lib/seo";

export async function JsonLd({ data }: { data: unknown }) {
  const requestHeaders = await headers();

  return (
    <script
      type="application/ld+json"
      nonce={requestHeaders.get("x-nonce") ?? undefined}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
