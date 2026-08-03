import { describe, expect, it } from "vitest";
import { createMockSupabaseClient, MockSupabaseError } from "./testing";

describe("Supabase mock sem Docker", () => {
  it("simula autenticação, consultas, inserções e atualizações", async () => {
    const client = createMockSupabaseClient({ tables: { profiles: [{ id: "u1", name: "Ana" }] } });
    expect(
      (await client.auth.signInWithPassword({ email: "ana@example.com", password: "secret" })).error
    ).toBeNull();
    expect((await client.from("profiles").select("id,name").eq("id", "u1").single()).data).toEqual({
      id: "u1",
      name: "Ana"
    });
    await client.from("profiles").update({ name: "Ana Curtiz" }).eq("id", "u1");
    expect((await client.from("profiles").select().eq("id", "u1").single()).data?.name).toBe(
      "Ana Curtiz"
    );
  });

  it("simula Storage privado e URL assinada", async () => {
    const client = createMockSupabaseClient();
    await client.storage.from("private").upload("u1/document.pdf", new Uint8Array([1, 2, 3]));
    const signed = await client.storage.from("private").createSignedUrl("u1/document.pdf", 60);
    expect(signed.data?.signedUrl).toContain("expires=60");
    expect((await client.storage.from("private").download("missing.pdf")).error?.code).toBe(
      "not_found"
    );
  });

  it("injeta e propaga erros controlados", async () => {
    const expected = new MockSupabaseError("42501", "permission denied");
    const client = createMockSupabaseClient({ errors: { "from:orders:select": expected } });
    expect((await client.from("orders").select()).error).toBe(expected);
  });

  it("simula filtros nulos usados por notificações do cliente", async () => {
    const client = createMockSupabaseClient({
      tables: {
        notifications: [
          { id: "n1", read_at: null },
          { id: "n2", read_at: "2026-08-03T12:00:00Z" }
        ]
      }
    });
    const result = await client.from("notifications").select().is("read_at", null);
    expect(result.data?.map((row) => row.id)).toEqual(["n1"]);
  });
});
