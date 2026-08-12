import { describe, expect, it } from "vitest";
import { postgresUuidSchema } from "./postgres-uuid";

describe("postgresUuidSchema", () => {
  it("aceita UUID determin\u00edstico usado pelo cat\u00e1logo", () => {
    expect(
      postgresUuidSchema.safeParse("20000000-0000-0000-0000-000000000001").success
    ).toBe(true);
  });

  it("aceita UUID v4 gerado para novos registros", () => {
    expect(
      postgresUuidSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success
    ).toBe(true);
  });

  it("rejeita valores que n\u00e3o podem ser convertidos pelo PostgreSQL", () => {
    expect(postgresUuidSchema.safeParse("produto-1").success).toBe(false);
  });
});
