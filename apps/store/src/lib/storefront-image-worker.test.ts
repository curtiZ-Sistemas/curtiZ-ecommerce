import { describe, expect, it, vi } from "vitest";
import { optimizeStorefrontImageRequest } from "./storefront-image-worker";

function createRuntime() {
  const widths: number[] = [];
  const cache = {
    match: vi.fn(async (): Promise<Response | undefined> => undefined),
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

  it("usa o original quando a variante importada antiga não existe e falta content-length", async () => {
    const runtime = createRuntime();
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);
      if (url.includes(".360.webp")) return new Response("not found", { status: 400 });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/webp" }
      });
    });
    const path = `products/imports/20000000-0000-4000-8000-000000000001/${"b".repeat(64)}.webp`;

    const response = await optimizeStorefrontImageRequest(
      new Request(`https://curtiz.com.br/media/product/${path}?w=360`),
      runtime.env,
      runtime.cache,
      runtime.context,
      fetcher
    );

    expect(response?.status).toBe(200);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain(`${"b".repeat(64)}.360.webp`);
    expect(requestedUrls[1]).toContain(`${"b".repeat(64)}.webp`);
    expect(runtime.images.input).toHaveBeenCalledOnce();
  });

  it("responde HEAD sem corpo mesmo quando a imagem está em cache", async () => {
    const runtime = createRuntime();
    runtime.cache.match.mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "image/webp" }
    }));

    const response = await optimizeStorefrontImageRequest(
      new Request("https://curtiz.com.br/media/product/products/user/item.webp?w=360", { method: "HEAD" }),
      runtime.env,
      runtime.cache,
      runtime.context,
      vi.fn()
    );

    expect(response?.status).toBe(200);
    expect(response?.body).toBeNull();
    expect(response?.headers.get("content-type")).toBe("image/webp");
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
