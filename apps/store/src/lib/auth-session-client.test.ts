import { beforeEach, describe, expect, it, vi } from "vitest";

describe("fetchPublicAuthSession", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("deduplica leituras simultâneas sem reutilizar sessão indefinidamente", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: true, fullName: "Cliente" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchPublicAuthSession } = await import("./auth-session-client");

    const [first, second] = await Promise.all([
      fetchPublicAuthSession(),
      fetchPublicAuthSession()
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);

    await fetchPublicAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
