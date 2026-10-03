import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  denied: [] as string[],
  safe: true,
  failed: "",
  throwFor: "",
  publications: 0,
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  queried: [] as string[],
  problems: new Map<string, string[]>()
}));
vi.mock("@/lib/admin-api", () => ({
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => state.safe,
  unauthorizedAdminResponse: () => new Response(null, { status: 403 }),
  objectRows: (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter(
          (item: unknown): item is Record<string, unknown> =>
            !!item && typeof item === "object" && !Array.isArray(item)
        )
      : []
}));
vi.mock("@/lib/legal-api", () => ({
  legalPermissions: ["legal_content.edit", "legal_content.publish"],
  authorizeLegalRequest: async (_request: Request, permission: string) =>
    state.denied.includes(permission)
      ? null
      : {
          supabase: {
            from: (table: string) => {
              state.queried.push(table);
              const result = { data: table === "company_legal_information" ? {} : [], error: null };
              const query = {
                order: async () => result,
                eq: () => ({ maybeSingle: async () => result })
              };
              return { select: () => query };
            },
            rpc: async (name: string, args?: Record<string, unknown>) => {
              state.calls.push({ name, args });
              if (name === "has_legal_permission") return { data: true, error: null };
              if (name === "validate_legal_policy_publication")
                return {
                  data: (args?.p_documents as { id: string }[]).map((document) => ({
                    id: document.id,
                    problems: state.problems.get(document.id) ?? []
                  })),
                  error: null
                };
              if (name === "publish_legal_policy") {
                if (args?.p_id === state.throwFor) throw new Error("transport unavailable");
                if (args?.p_id === state.failed)
                  return { error: { message: "legal concurrent change" }, data: null };
                state.publications++;
                return {
                  data: { versionId: "test-version", unchanged: state.publications > 1 },
                  error: null
                };
              }
              return { data: { document: { slug: args?.p_slug }, unchanged: false }, error: null };
            }
          }
        }
}));
import { GET, POST } from "./route";
const id1 = "a1000000-0000-4000-8000-000000000001",
  id2 = "a1000000-0000-4000-8000-000000000002";
const updated_at = "2026-10-03T12:00:00.123456+00:00";
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:3001/api/legal/policies", {
      method: "POST",
      headers: { origin: "http://localhost:3001", "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
const draft = {
  action: "import",
  slug: "aviso-de-privacidade",
  title: "Política de Privacidade",
  sections: [
    {
      section_number: "1",
      title: "Responsável",
      content: "[CNPJ]",
      content_format: "plain",
      sort_order: 0
    }
  ],
  expectedUpdatedAt: updated_at
};
describe("API das políticas", () => {
  beforeEach(() => {
    state.denied = [];
    state.safe = true;
    state.failed = "";
    state.throwFor = "";
    state.calls = [];
    state.queried = [];
    state.problems = new Map();
    state.publications = 0;
  });
  it("carrega só documentos, seções e empresa", async () => {
    const response = await GET(new NextRequest("http://localhost:3001/api/legal/policies"));
    expect(response.status).toBe(200);
    expect(state.queried).toEqual([
      "legal_documents",
      "legal_document_sections",
      "company_legal_information"
    ]);
  });
  it("rejeita chamada direta sem permissão de edição ou publicação", async () => {
    state.denied = ["legal_content.edit", "legal_content.publish"];
    expect((await post(draft)).status).toBe(403);
    expect((await post({ action: "publish", documents: [{ id: id1, updated_at }] })).status).toBe(
      403
    );
    expect(state.calls).toEqual([]);
  });
  it("rejeita origem externa antes de qualquer RPC", async () => {
    state.safe = false;
    expect((await post(draft)).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it("salva minuta incompleta no destino canônico sem mudar configurações", async () => {
    expect((await post(draft)).status).toBe(200);
    expect(state.calls[0]).toEqual({
      name: "import_legal_policy",
      args: {
        p_slug: draft.slug,
        p_title: draft.title,
        p_sections: draft.sections,
        p_expected_updated_at: updated_at
      }
    });
  });
  it("rejeita slug arbitrário e lote duplicado", async () => {
    expect((await post({ ...draft, slug: "politica-de-privacidade" })).status).toBe(400);
    expect(
      (
        await post({
          action: "publish",
          documents: [
            { id: id1, updated_at },
            { id: id1, updated_at }
          ]
        })
      ).status
    ).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it("valida todas antes de publicar e comunica pendências", async () => {
    state.problems.set(id2, ["[CNPJ]"]);
    const response = await post({
      action: "publish",
      documents: [
        { id: id1, updated_at },
        { id: id2, updated_at }
      ]
    });
    const payload = (await response.json()) as {
      results: { published: boolean; problems: string[] }[];
    };
    expect(payload.results.map((item) => item.published)).toEqual([true, false]);
    expect(payload.results[1]?.problems).toContain("[CNPJ]");
    expect(state.calls.map((call) => call.name)).toEqual([
      "validate_legal_policy_publication",
      "publish_legal_policy"
    ]);
  });
  it("mantém resultado parcial em alteração concorrente e falha de transporte", async () => {
    state.failed = id2;
    let response = await post({
      action: "publish",
      documents: [
        { id: id1, updated_at },
        { id: id2, updated_at }
      ]
    });
    expect(
      ((await response.json()) as { results: { published: boolean }[] }).results.map(
        (result) => result.published
      )
    ).toEqual([true, false]);
    state.throwFor = id2;
    response = await post({
      action: "publish",
      documents: [
        { id: id1, updated_at },
        { id: id2, updated_at }
      ]
    });
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { results: { published: boolean }[] }).results[1]?.published
    ).toBe(false);
  });
  it("repassa retry idempotente sem simular revisão jurídica", async () => {
    const body = { action: "publish", documents: [{ id: id1, updated_at }] };
    await post(body);
    const response = await post(body);
    expect(
      ((await response.json()) as { results: { unchanged: boolean }[] }).results[0]?.unchanged
    ).toBe(true);
    expect(state.calls.some((call) => call.name === "transition_legal_document")).toBe(false);
  });
});
