import { describe, expect, it, vi } from "vitest";
import { optimizeStorefrontImageRequest } from "./storefront-image-worker";

function createRuntime() {
  const widths: number[] = [];
  const cache = {
    match: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined)
  };
  const context = { waitUntil: vi.fn((promise: Promise<unknown>) => void promise) };
  const images = {
    info: vi.fn(async (stream: ReadableStream<Uint8Array>) => {
      await new Response(stream).arrayBuffer();
      return { width: 1600, height: 900 };
    }),
    input: vi.fn((stream: ReadableStream<Uint8Array>) => ({
      transform: vi.fn((options: { width: number }) => {
        widths.push(options.width);
        return {
          output: async () => {
            await new Response(stream).arrayBuffer();
            return {
              response: () => new Response(new Uint8Array([7, 8, 9]), {
                headers: { "content-type": "image/webp" }
              })
            };
          }
        };
      })
    }))
  };
  const env = { SUPABASE_URL: "https://catalog.example.test/", IMAGES: images };
  return { cache, context, env, images, widths };
}

describe("otimização de imagens na borda", () => {
  it("converte banner remoto para WebP no tamanho solicitado e mantém noindex", async () => {
    const runtime = createRuntime();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" }
    }));

    const response = await optimizeStorefrontImageRequest(
      new Request("https://curtiz.com.br/media/banner/banners/banner-id/mobile.png?w=720"),
      runtime.env,
      runtime.cache,
      runtime.context,
      fetcher
    );

    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex, noimageindex");
    expect(response?.headers.get("cache-control")).toContain("immutable");
    expect(runtime.widths).toEqual([720]);
    expect(runtime.cache.put).toHaveBeenCalledOnce();
  });

  it("serve derivado previamente gerado no import sem transformar novamente", async () => {
    const runtime = createRuntime();
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "3" }
      });
    });
    const path = `products/imports/20000000-0000-4000-8000-000000000001/${"a".repeat(64)}.webp`;

    const response = await optimizeStorefrontImageRequest(
      new Request(`https://curtiz.com.br/media/product/${path}?w=360`),
      runtime.env,
      runtime.cache,
      runtime.context,
      fetcher
    );

    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(requestedUrls[0]).toContain(`${"a".repeat(64)}.360.webp`);
    expect(runtime.images.input).not.toHaveBeenCalled();
  });

  it("deixa imagens originais e caminhos inválidos fora do transformador", async () => {
    const runtime = createRuntime();
    const fetcher = vi.fn();

    await expect(optimizeStorefrontImageRequest(
      new Request("https://curtiz.com.br/media/banner/banners/banner-id/mobile.png"),
      runtime.env,
      runtime.cache,
      runtime.context,
      fetcher
    )).resolves.toBeNull();

    const invalid = await optimizeStorefrontImageRequest(
      new Request("https://curtiz.com.br/media/product/products/../private.webp?w=360"),
      runtime.env,
      runtime.cache,
      runtime.context,
      fetcher
    );
    expect(invalid?.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
