import { describe, expect, it } from "vitest";
import { classifyCartSyncFailure, isMissingCartSyncRpc } from "./cart-sync-error";

describe("cart sync errors", () => {
  it("identifica ausência da RPC para ativar compatibilidade", () => {
    expect(isMissingCartSyncRpc({ code: "PGRST202" })).toBe(true);
    expect(isMissingCartSyncRpc({ code: "42883" })).toBe(true);
    expect(isMissingCartSyncRpc({ code: "42501" })).toBe(false);
  });

  it("não converte todo erro em indisponibilidade", () => {
    expect(classifyCartSyncFailure({ code: "42501" }).status).toBe(403);
    expect(classifyCartSyncFailure({ code: "23514" }).status).toBe(422);
    expect(classifyCartSyncFailure({ code: "XX000" }).status).toBe(500);
    expect(classifyCartSyncFailure({ code: "PGRST000" }).status).toBe(503);
  });
});
