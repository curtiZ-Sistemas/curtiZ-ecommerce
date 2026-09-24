import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sections: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  lifecycleAllowed: true,
  nextId: 1,
  plan: {
    hasProducts: false,
    sheets: { categories: false, navigation: false },
    options: {
      sincronizar_menu_categorias: false,
      organizar_home_automaticamente: true,
      publicar_home_automaticamente: false,
      mostrar_categorias_home: false,
      mostrar_mais_vendidos: false,
      mostrar_destaques: false,
      mostrar_novidades: false,
      mostrar_recomendados: false,
      mostrar_storytelling: false,
      mostrar_faq: true,
      mostrar_beneficios: false
    },
    categories: [],
    navigation: [],
    homeSections: [{ key: "faq", type: "faq", title: "Dúvidas frequentes",
      subtitle: "Ajuda rápida antes de finalizar sua compra.", active: true,
      source: "FAQ", limit: 8, sortOrder: 70 }],
    stories: [],
    faq: [{ key: "tamanho", question: "Pergunta dinâmica?", answer: "Resposta da planilha.", sortOrder: 1, active: true }]
  }
}));

vi.mock("@curtiz/security", () => ({
  logServerEvent: vi.fn(),
  readFormResponse: (request: Request) => request.formData()
}));
vi.mock("@/lib/admin-api", () => ({
  privateNoStore: { "cache-control": "private, no-store" },
  safePanelOrigin: () => true,
  unauthorizedAdminResponse: () => new Response(null, { status: 403 }),
  objectRows: (value: unknown) => Array.isArray(value) ? value : [],
  authorizeAdminRequest: async () => ({
    supabase: {
      from: () => {
        const query = {
          select() { return this; },
          like() { return this; },
          order() { return this; },
          async range(start: number, end: number) {
            return { data: state.sections.slice(start, end + 1), error: null };
          }
        };
        return query;
      },
      rpc: async (name: string, args?: Record<string, unknown>) => {
        state.calls.push({ name, args });
        if (name === "has_homepage_permission") {
          return { data: state.lifecycleAllowed, error: null };
        }
        if (name === "has_permission") return { data: true, error: null };
        if (name === "get_home_categories" || name === "get_homepage_best_sellers") {
          return { data: [], error: null };
        }
        if (name === "search_catalog") return { data: { products: [] }, error: null };
        if (name === "transition_homepage_section") {
          const section = state.sections.find((item) => item.id === args?.p_section_id);
          if (section) section.status = args?.p_action === "archive" ? "archived" : "draft";
          return { data: null, error: null };
        }
        if (name === "save_homepage_section") {
          const payload = args?.p_payload as Record<string, unknown>;
          const id = typeof payload.id === "string" ? payload.id : `managed-${state.nextId++}`;
          const current = state.sections.find((item) => item.id === id);
          const section = {
            id,
            internal_name: payload.internalName,
            section_type: payload.sectionType,
            revision: Number(current?.revision ?? 0) + 1,
            content_config: payload.content,
            status: "draft",
            updated_at: "2026-09-24T12:00:00Z"
          };
          if (current) Object.assign(current, section);
          else state.sections.push(section);
          return { data: id, error: null };
        }
        return { data: {}, error: null };
      }
    }
  })
}));
vi.mock("@/lib/store-config-import", () => ({
  STORE_CONFIG_MAX_BYTES: 5 * 1024 * 1024,
  parseStoreConfigWorkbook: async () => state.plan
}));
vi.mock("@/lib/store-config-sections", async () => import("../../../../lib/store-config-sections"));
vi.mock("server-only", () => ({}));

import { POST } from "./route";

async function post(action: "preview" | "apply") {
  const form = new FormData();
  form.set("file", new File(["test xlsx"], "store-config.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }));
  form.set("action", action);
  return POST(new NextRequest("https://panel.example/api/catalog/store-config", { method: "POST", body: form }));
}

describe("sincronização da configuração da home", () => {
  beforeEach(() => {
    state.sections = [];
    state.calls = [];
    state.lifecycleAllowed = true;
    state.nextId = 1;
  });

  it("mostra o arquivamento no preview sem tratá-lo como erro", async () => {
    state.sections = [{ id: "old-story", internal_name: "xlsx:storytelling", section_type: "institutional",
      revision: 4, content_config: {}, status: "published", updated_at: "2026-09-20T12:00:00Z" }];

    const response = await post("preview");
    const preview = await response.json() as { sections: Array<{ key: string; action: string }>; warnings: string[] };

    expect(response.status).toBe(200);
    expect(preview.sections).toContainEqual({ key: "faq", type: "faq", action: "create" });
    expect(preview.sections).toContainEqual({ key: "storytelling", type: "institutional", action: "archive" });
    expect(preview.warnings.some((warning) => warning.includes("próxima publicação"))).toBe(true);
    expect(state.calls.some((call) => call.name === "transition_homepage_section")).toBe(false);
  });

  it("arquiva storytelling, preserva FAQ e deixa a segunda aplicação sem alterações", async () => {
    state.sections = [{ id: "old-story", internal_name: "xlsx:storytelling", section_type: "institutional",
      revision: 4, content_config: {}, status: "published", updated_at: "2026-09-20T12:00:00Z" }];

    const firstResponse = await post("apply");
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({ saved: ["faq"], archived: ["storytelling"] });
    expect(state.sections).toHaveLength(2);
    expect(state.sections.find((section) => section.id === "old-story")?.status).toBe("archived");
    expect(state.sections.find((section) => section.internal_name === "xlsx:faq")?.status).toBe("draft");

    const previousSideEffects = state.calls.filter((call) => ["save_homepage_section", "transition_homepage_section"].includes(call.name)).length;
    const secondResponse = await post("apply");
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toMatchObject({ saved: [], archived: [], message: "Configuração já estava atualizada." });
    expect(state.sections).toHaveLength(2);
    expect(state.calls.filter((call) => ["save_homepage_section", "transition_homepage_section"].includes(call.name)))
      .toHaveLength(previousSideEffects);
  });

  it("restaura a mesma seção FAQ arquivada em vez de criar uma duplicata", async () => {
    state.sections = [{ id: "old-faq", internal_name: "xlsx:faq", section_type: "faq", revision: 3,
      content_config: {}, status: "archived", updated_at: "2026-09-20T12:00:00Z" }];

    const response = await post("apply");

    expect(response.status).toBe(200);
    expect(state.sections).toHaveLength(1);
    expect(state.sections[0]).toMatchObject({ id: "old-faq", internal_name: "xlsx:faq", status: "draft" });
    expect(state.calls).toContainEqual({ name: "transition_homepage_section", args: {
      p_section_id: "old-faq", p_action: "restore", p_reason: "Seção retornou à configuração gerenciada da loja"
    } });
  });

  it("exige permissão de publicação antes de arquivar seções", async () => {
    state.lifecycleAllowed = false;
    state.sections = [{ id: "old-story", internal_name: "xlsx:storytelling", section_type: "institutional",
      revision: 4, content_config: {}, status: "published", updated_at: "2026-09-20T12:00:00Z" }];

    const response = await post("apply");

    expect(response.status).toBe(403);
    expect(state.sections[0]?.status).toBe("published");
    expect(state.calls.some((call) => call.name === "admin_sync_store_navigation"
      || call.name === "transition_homepage_section" || call.name === "save_homepage_section")).toBe(false);
  });
});
