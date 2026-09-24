import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sections: [] as Array<{ id: string; status: string; current_version_id: string }>,
  denied: [] as string[],
  publishCalls: 0,
  publishError: "",
  prepareError: "",
  calls: [] as Array<{ name: string; args: Record<string, unknown> | undefined }>
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
        from: () => ({ select: () => ({
          like: () => ({ in: () => ({ limit: async () => ({ data: state.sections, error: null }) }) })
        }) }),
        rpc: async (name: string, args?: Record<string, unknown>) => {
          state.calls.push({ name, args });
          if (name === "prepare_xlsx_homepage_publication" && state.prepareError) {
            return { data: null, error: { code: state.prepareError } };
          }
          if (name === "publish_homepage") {
            state.publishCalls += 1;
            if (state.publishError) return { data: null, error: { message: state.publishError } };
          }
          return { data: null, error: null };
        }
      }
    })
}));

import { POST } from "./route";

const section = { id: "10000000-0000-4000-8000-000000000001", status: "draft",
  current_version_id: "20000000-0000-4000-8000-000000000001" };
const post = (action: "publish" | "prepare_publish", confirmed = false) => POST(new NextRequest("https://panel.example/api/homepage-builder", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action, reason: "Revisão da home",
    ...(action === "prepare_publish" ? { expectedVersions: [{ sectionId: section.id, versionId: section.current_version_id }],
      selfApprovalConfirmed: confirmed } : {}) })
}));

describe("publicação da homepage", () => {
  beforeEach(() => {
    state.sections = [];
    state.denied = [];
    state.publishCalls = 0;
    state.publishError = "";
    state.prepareError = "";
    state.calls = [];
  });

  it("bloqueia publicação normal enquanto a planilha tem rascunhos", async () => {
    state.sections = [section];
    const response = await post("publish");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_SECTION_REVIEW_REQUIRED");
    expect(state.publishCalls).toBe(0);
  });

  it("publica normalmente quando não há seção pendente", async () => {
    const response = await post("publish");
    expect(response.status).toBe(200);
    expect(state.publishCalls).toBe(1);
  });

  it("retorna código seguro quando não há seção aprovada", async () => {
    state.publishError = "no approved homepage sections";
    const response = await post("publish");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_NO_APPROVED_SECTIONS");
  });

  it("permite ao editor enviar versões exatas para revisão sem autoaprovar", async () => {
    state.denied = ["homepage.review", "homepage.publish"];
    const response = await post("prepare_publish");
    expect(response.status).toBe(200);
    expect((await response.json() as { message: string }).message).toContain("Outro revisor");
    expect(state.calls).toEqual([{ name: "prepare_xlsx_homepage_publication", args: {
      p_reason: "Revisão da home",
      p_expected_versions: [{ sectionId: section.id, versionId: section.current_version_id }],
      p_self_approval_confirmed: false
    } }]);
  });

  it("nega confirmação sem homepage.edit", async () => {
    state.denied = ["homepage.edit"];
    expect((await post("prepare_publish", true)).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it.each(["homepage.review", "homepage.publish"])("retorna erro seguro sem %s", async (permission) => {
    state.denied = [permission];
    state.prepareError = "42501";
    const response = await post("prepare_publish", true);
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_SELF_APPROVAL_NOT_ALLOWED");
    expect(state.calls).toHaveLength(1);
  });

  it("nega papel sem autoridade mesmo com as três permissões", async () => {
    state.prepareError = "P4001";
    const response = await post("prepare_publish", true);
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_SELF_APPROVAL_NOT_ALLOWED");
  });

  it("confirma o override por uma única RPC transacional", async () => {
    const response = await post("prepare_publish", true);
    expect(response.status).toBe(200);
    expect((await response.json() as { message: string }).message).toBe("Página publicada com sucesso.");
    expect(state.calls.map((call) => call.name)).toEqual(["prepare_xlsx_homepage_publication"]);
    expect(state.calls[0]?.args?.p_self_approval_confirmed).toBe(true);
  });

  it.each([
    ["P4002", "HOMEPAGE_SECTION_VALIDATION_FAILED", "validation"],
    ["P4003", "HOMEPAGE_PUBLICATION_FAILED", "publish"],
    ["P4004", "HOMEPAGE_SECTIONS_CHANGED", "review"]
  ])("devolve erro seguro %s sem publicação parcial", async (error, code, stage) => {
    state.prepareError = error;
    const response = await post("prepare_publish", true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code, stage });
    expect(state.publishCalls).toBe(0);
  });
});
