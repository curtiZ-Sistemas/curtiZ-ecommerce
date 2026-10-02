import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicLegalDocument, getPublicLegalDocuments } from "./legal-data";

const mocks = vi.hoisted(() => ({ client: vi.fn(), order: vi.fn() }));
vi.mock("./supabase/server", () => ({ createServerSupabaseClient: mocks.client }));

describe("published legal documents availability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.client.mockResolvedValue({ from: () => ({ select: () => ({ order: mocks.order }) }) });
  });

  it("distinguishes a failed query from an empty publication list", async () => {
    mocks.order.mockResolvedValue({ error: { code: "test_database_unavailable" }, data: null });
    await expect(getPublicLegalDocuments()).resolves.toEqual({ documents: [], unavailable: true });
  });

  it("distinguishes missing database configuration from unpublished documents", async () => {
    mocks.client.mockResolvedValue(null);
    await expect(getPublicLegalDocuments()).resolves.toEqual({ documents: [], unavailable: true });
  });

  it("reports an empty successful query as available", async () => {
    mocks.order.mockResolvedValue({ error: null, data: [] });
    await expect(getPublicLegalDocuments()).resolves.toEqual({ documents: [], unavailable: false });
  });

  it("preserves the unavailable state when opening a document", async () => {
    mocks.order.mockResolvedValue({ error: { code: "test_database_unavailable" }, data: null });
    await expect(getPublicLegalDocument("privacidade")).resolves.toEqual({ document: null, unavailable: true });
  });

  it("handles a transport failure without exposing error details", async () => {
    mocks.order.mockRejectedValue(new Error("test-only transport failure"));
    await expect(getPublicLegalDocuments()).resolves.toEqual({ documents: [], unavailable: true });
  });

  it("keeps published documents visible and resolves their slug", async () => {
    mocks.order.mockResolvedValue({ error: null, data: [{
      document_id: "published-test-document", slug: "privacidade", public_title: "Privacidade",
      snapshot: { sections: [], references: [], company: {} }
    }] });
    const result = await getPublicLegalDocument("privacidade");
    expect(result.unavailable).toBe(false);
    expect(result.document).toMatchObject({ id: "published-test-document", slug: "privacidade", title: "Privacidade" });
  });

  it("distinguishes an unpublished slug from an unavailable query", async () => {
    mocks.order.mockResolvedValue({ error: null, data: [] });
    await expect(getPublicLegalDocument("privacidade")).resolves.toEqual({ document: null, unavailable: false });
  });
});
