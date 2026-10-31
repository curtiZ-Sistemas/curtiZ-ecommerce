import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("scheduled Workerd transport", () => {
  it("uses manual mode for credential-bearing requests that forbid redirects", async () => {
    const response = new Response("0");
    const native = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      if (init?.redirect === "error") throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", native);
    const { scheduledFetch } = await import("./worker-native-fetch");
    const init: RequestInit = { method: "POST", redirect: "error", body: "{}",
      headers: { authorization: "Bearer test-only-value" }, signal: AbortSignal.timeout(1000) };
    await expect(scheduledFetch("https://api.example.invalid/rpc", init)).resolves.toBe(response);
    expect(native).toHaveBeenCalledExactlyOnceWith("https://api.example.invalid/rpc", { ...init, redirect: "manual" });
    expect(init.redirect).toBe("error");
  });

  it.each([301, 302, 303, 307, 308])("rejects HTTP %s without following or replaying the request", async status => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      status, headers: { location: "https://untrusted.example.invalid/" }
    });
    const native = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", native);
    const { scheduledFetch } = await import("./worker-native-fetch");
    await expect(scheduledFetch("https://api.example.invalid/rpc", { redirect: "error", method: "POST", body: "{}" }))
      .rejects.toThrow("Scheduled fetch rejected an upstream redirect");
    expect(native).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("preserves Request inputs, caller overrides and non-redirect failures", async () => {
    const response = new Response("unavailable", { status: 503 });
    const native = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", native);
    const { scheduledFetch } = await import("./worker-native-fetch");
    const request = new Request("https://api.example.invalid/rpc", { method: "POST", body: "{}", redirect: "error" });
    await expect(scheduledFetch(request)).resolves.toBe(response);
    expect(native).toHaveBeenLastCalledWith(request, { redirect: "manual" });
    await expect(scheduledFetch(request, { redirect: "follow" })).resolves.toBe(response);
    expect(native).toHaveBeenLastCalledWith(request, { redirect: "follow" });
  });

  it("retains native fetch after Next replaces the global implementation", async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", native);
    const { scheduledFetch } = await import("./worker-native-fetch");
    const patched = vi.fn<typeof fetch>().mockRejectedValue(new Error("No Next request storage"));
    vi.stubGlobal("fetch", patched);
    await scheduledFetch("https://api.example.invalid/rpc", { redirect: "error" });
    expect(native).toHaveBeenCalledOnce();
    expect(patched).not.toHaveBeenCalled();
  });
});
