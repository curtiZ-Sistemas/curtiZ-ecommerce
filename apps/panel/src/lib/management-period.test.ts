import { describe, expect, it } from "vitest";
import { managementPeriodFor } from "./management-period";

describe("managementPeriodFor", () => {
  const today = "2026-09-02";

  it("calcula os atalhos padronizados", () => {
    expect(managementPeriodFor("today", today)).toEqual({ from: today, to: today });
    expect(managementPeriodFor("7days", today)).toEqual({ from: "2026-08-27", to: today });
    expect(managementPeriodFor("30days", today)).toEqual({ from: "2026-08-04", to: today });
    expect(managementPeriodFor("month", today)).toEqual({ from: "2026-09-01", to: today });
    expect(managementPeriodFor("previous", today)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31"
    });
    expect(managementPeriodFor("year", today)).toEqual({ from: "2026-01-01", to: today });
  });
});
