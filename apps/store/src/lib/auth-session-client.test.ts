import { beforeEach, describe, expect, it, vi } from "vitest";

describe("fetchPublicAuthSession", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("reutiliza uma leitura por documento e permite invalidar após mudança de sessão", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ authenticated: true, fullName: "Cliente" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { clearPublicAuthSessionCache, fetchPublicAuthSession } = await import("./auth-session-client");

    const [first, second] = await Promise.all([
      fetchPublicAuthSession(),
      fetchPublicAuthSession()
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);

    await fetchPublicAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearPublicAuthSessionCache();
    await fetchPublicAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
