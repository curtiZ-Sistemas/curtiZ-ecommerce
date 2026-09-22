import { afterEach, describe, expect, it, vi } from "vitest";
import { processProductImageMessage, type Env } from "./index";

const message = {
  jobId: "20000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000002",
  productId: "20000000-0000-4000-8000-000000000003"
};

function responseJson(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function requestUrl(input: string | URL | Request) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function environment(): Env {
  return {
    SUPABASE_URL: "https://project.supabase.co/",
    SUPABASE_SECRET_KEY: "service-secret",
    IMAGES: {
      info: vi.fn(async (stream: ReadableStream<Uint8Array>) => {
        await new Response(stream).arrayBuffer();
        return { width: 800, height: 800, format: "image/jpeg" };
      }),
      input: vi.fn((stream: ReadableStream<Uint8Array>) => ({
        output: async () => {
          await new Response(stream).arrayBuffer();
          return { response: () => new Response(new Uint8Array([8, 9, 10]), { status: 200, headers: { "content-type": "image/webp" } }) };
        }
      }))
    }
  };
}

describe("product import image queue consumer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("acknowledges an already completed idempotent job without touching storage or CDN", async () => {
    const fetchMock = vi.fn(async () => responseJson({ state: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(processProductImageMessage(message, environment())).resolves.toEqual({ retry: false, state: "completed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("processes exactly one missing image and completes its metadata", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input); calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/claim_product_import_image_job")) return responseJson({
        state: "claimed", productId: message.productId, sourceUrl: "https://down-sg.img.susercontent.com/file/a",
        storagePath: `products/imports/${message.productId}/${"a".repeat(64)}.webp`, attempt: 1
      });
      if (url.includes("/object/authenticated/")) return new Response(null, { status: 404 });
      if (url.startsWith("https://down-sg.img.susercontent.com/")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "4" } });
      }
      if (url.includes("/storage/v1/object/")) {
        await new Response(init?.body as BodyInit).arrayBuffer();
        return responseJson({ Key: "stored" });
      }
      if (url.endsWith("/complete_product_import_image_job")) return responseJson({ state: "completed" });
      throw new Error(`unexpected request ${url}`);
    }));

    await expect(processProductImageMessage(message, environment())).resolves.toEqual({ retry: false, state: "completed" });
    expect(calls.filter((call) => call.includes("down-sg.img.susercontent.com"))).toHaveLength(1);
    expect(calls.some((call) => call.endsWith("/complete_product_import_image_job"))).toBe(true);
  });

  it("persists a transient CDN failure before asking Queue for a retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url.endsWith("/claim_product_import_image_job")) return responseJson({
        state: "claimed", productId: message.productId, sourceUrl: "https://down-sg.img.susercontent.com/file/a",
        storagePath: `products/imports/${message.productId}/${"a".repeat(64)}.webp`, attempt: 1
      });
      if (url.includes("/object/authenticated/")) return new Response(null, { status: 404 });
      if (url.startsWith("https://down-sg.img.susercontent.com/")) return new Response(null, { status: 503 });
      if (url.endsWith("/fail_product_import_image_job")) return responseJson({ retry: true, state: "queued" });
      throw new Error(`unexpected request ${url}`);
    }));

    await expect(processProductImageMessage(message, environment())).resolves.toEqual({ retry: true, state: "queued" });
  });
});
