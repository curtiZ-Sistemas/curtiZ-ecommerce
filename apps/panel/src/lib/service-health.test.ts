import { describe, expect, it } from "vitest";
import { backupStatus, httpServiceState } from "./service-health";

describe("diagnóstico técnico sem sucesso presumido", () => {
  it("não declara erros HTTP como serviço online", () => {
    for (const status of [401, 403, 404, 429, 500, 503]) expect(httpServiceState(status, 50)).toBe("offline");
    expect(httpServiceState(200, 50)).toBe("online");
    expect(httpServiceState(200, 2001)).toBe("degraded");
    expect(httpServiceState(302, 50)).toBe("degraded");
  });
  it("variável de provedor não comprova cópias nem restauração", () => {
    expect(backupStatus("supabase")).toContain("não verificadas");
    expect(backupStatus(undefined)).toContain("não verificado");
    expect(backupStatus(" ")).toBe(backupStatus(undefined));
  });
});
