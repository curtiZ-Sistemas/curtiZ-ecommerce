import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  sections: [] as Array<{ id: string; status: string; current_version_id: string }>,
  authorId: "another-user",
  publishCalls: 0,
  publishError: "",
  transitions: [] as string[]
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
  authorizeHomepageRequest: async () => ({
    userId: "current-user",
    supabase: {
      from: () => ({
        select: () => ({
          like: () => ({ in: () => ({ limit: async () => ({ data: state.sections, error: null }) }) }),
          in: async () => ({ data: state.sections.map((section) => ({ id: section.current_version_id, changed_by: state.authorId })), error: null })
        })
      }),
      rpc: async (name: string, args?: { p_action?: string }) => {
        if (name === "has_homepage_permission") return { data: true, error: null };
        if (name === "transition_homepage_section") {
          state.transitions.push(args?.p_action ?? "");
          if (args?.p_action === "approve") state.sections = [];
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

const section = { id: "10000000-0000-4000-8000-000000000001", status: "draft", current_version_id: "20000000-0000-4000-8000-000000000001" };
const post = (action: "publish" | "prepare_publish") => POST(new NextRequest("https://panel.example/api/homepage-builder", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason: "Revisão da home" })
}));

describe("publicação da homepage", () => {
  beforeEach(() => {
    state.sections = [];
    state.authorId = "another-user";
    state.publishCalls = 0;
    state.publishError = "";
    state.transitions = [];
  });

  it("bloqueia publicação quando a planilha tem rascunhos", async () => {
    state.sections = [section];
    const response = await post("publish");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_SECTION_REVIEW_REQUIRED");
    expect(state.publishCalls).toBe(0);
  });

  it("publica quando não há seção pendente", async () => {
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

  it("envia rascunho do próprio autor para revisão sem aprová-lo", async () => {
    state.sections = [section];
    state.authorId = "current-user";
    const response = await post("prepare_publish");
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("HOMEPAGE_AUTHOR_CANNOT_APPROVE");
    expect(state.transitions).toEqual(["submit_review"]);
    expect(state.publishCalls).toBe(0);
  });

  it("prepara, aprova e publica quando a revisão é permitida", async () => {
    state.sections = [section];
    const response = await post("prepare_publish");
    expect(response.status).toBe(200);
    expect(state.transitions).toEqual(["submit_review", "approve"]);
    expect(state.publishCalls).toBe(1);
  });
});
