import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: [] as string[],
  calls: [] as Array<{ name: string; args: Record<string, unknown> | undefined }>,
  error: null as null | { code: string; message: string }
}));

vi.mock("@curtiz/security", () => ({ readJsonResponse: (request: Request) => request.json() }));
vi.mock("@/lib/admin-api", () => ({
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => true,
  unauthorizedAdminResponse: () => new Response(null, { status: 403 }),
  objectRows: (value: unknown) => value ?? []
}));
vi.mock("@/lib/homepage-api", () => ({
  homepagePermissions: [],
  authorizeHomepageRequest: async (_request: Request, permission: string) =>
    state.denied.includes(permission) ? null : ({
      userId: "current-user",
      supabase: {
        rpc: async (name: string, args?: Record<string, unknown>) => {
          state.calls.push({ name, args });
          return { data: "10000000-0000-4000-8000-000000000001", error: state.error };
        }
      }
    })
}));

import { POST } from "./route";

const post = (body: Record<string, unknown>) => POST(new NextRequest("https://panel.example/api/homepage-builder", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}));

describe("publicação direta da homepage", () => {
  beforeEach(() => {
    state.denied = [];
    state.calls = [];
    state.error = null;
  });

  it("publica pelo botão normal sem consultar revisão, mesmo sem homepage.review", async () => {
    state.denied = ["homepage.review", "homepage.edit"];
    const response = await post({ action: "publish", reason: "Publicar seis seções pendentes" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ message: "Página publicada com sucesso." });
    expect(state.calls).toEqual([{ name: "publish_homepage", args: {
      p_reason: "Publicar seis seções pendentes", p_scheduled_at: null
    } }]);
  });

  it("preserva agendamento", async () => {
    const scheduledAt = "2026-10-01T12:00:00Z";
    const response = await post({ action: "publish", reason: "Agendar página", scheduledAt });
    expect(response.status).toBe(200);
    expect((await response.json() as { message: string }).message).toBe("Publicação agendada.");
    expect(state.calls[0]?.args?.p_scheduled_at).toBe(scheduledAt);
  });

  it("exige homepage.publish", async () => {
    state.denied = ["homepage.publish"];
    expect((await post({ action: "publish", reason: "Publicar página" })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("rejeita a ação antiga prepare_publish", async () => {
    const response = await post({ action: "prepare_publish", reason: "Revisão antiga" });
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });

  it("devolve erro seguro para snapshot inválido", async () => {
    state.error = { code: "P4002", message: "homepage section validation failed" };
    const response = await post({ action: "publish", reason: "Publicar página" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ stage: "publish", code: "HOMEPAGE_SECTION_VALIDATION_FAILED" });
  });

  it("distingue a ausência de seções", async () => {
    state.error = { code: "P4002", message: "no publishable homepage sections" };
    const response = await post({ action: "publish", reason: "Publicar página" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "HOMEPAGE_NO_SECTIONS" });
  });

  it("não expõe erros internos do banco", async () => {
    state.error = { code: "XX000", message: "internal database failure" };
    const response = await post({ action: "publish", reason: "Publicar página" });
    expect(response.status).toBe(409);
    const result = await response.json() as { code: string; message: string };
    expect(result.code).toBe("HOMEPAGE_PUBLICATION_FAILED");
    expect(result.message).not.toContain("database");
  });
});
