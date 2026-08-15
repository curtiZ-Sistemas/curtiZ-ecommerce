import { describe, expect, it } from "vitest";
import { postgresUuidSchema } from "./postgres-uuid";

describe("postgresUuidSchema", () => {
  it("aceita UUID determinístico usado pelo catálogo", () => {
    expect(
      postgresUuidSchema.safeParse("20000000-0000-0000-0000-000000000001").success
    ).toBe(true);
  });

  it("aceita UUID v4 gerado para novos registros", () => {
    expect(
      postgresUuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success
    ).toBe(true);
  });

  it("rejeita identificador incompatível com PostgreSQL", () => {
    expect(postgresUuidSchema.safeParse("produto-1").success).toBe(false);
  });
});
