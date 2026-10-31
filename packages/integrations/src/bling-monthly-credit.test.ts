import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { calculateBlingMonthlyCredit, readBlingMonthlyCredit } from "./bling-monthly-credit";

const period = { application_month: "2026-01-01", reference_month: "2025-12-01", rate: "1.2500", revision: 2,
  evidence_reference: "Synthetic isolated approval", approved_by: "10000000-0000-4000-8000-000000000001", approved_at: "2026-01-01T12:00:00Z" };
describe("competence-bound approved ICMS credit", () => {
  it("uses the preceding apuration month across year boundaries", () => {
    expect(readBlingMonthlyCredit([period], "2026-01-31")).toMatchObject({ applicationMonth: "2026-01-01", referenceMonth: "2025-12-01", rate: 1.25, revision: 2 });
  });
  it.each([undefined, "", "2026-02-30", "2026-13-01", "01/01/2026"])("rejects missing or invalid sale date %s", date => {
    expect(() => readBlingMonthlyCredit([period], date)).toThrow("fiscal_credit_competence_required");
  });
  it("rejects a missing month, duplicate revisions and incomplete evidence", () => {
    for (const rows of [[], [period, period], [{ ...period, rate: 0 }], [{ ...period, reference_month: "2026-01-01" }],
      [{ ...period, evidence_reference: "" }], [{ ...period, approved_by: "" }], [{ ...period, approved_at: "invalid" }]])
      expect(() => readBlingMonthlyCredit(rows, "2026-01-24")).toThrow("fiscal_monthly_credit_required");
    expect(() => readBlingMonthlyCredit([period], "2026-02-01")).toThrow("fiscal_monthly_credit_required");
  });
  it("rounds each reviewed item base in integer cents and formats the approved message", () => {
    const result = calculateBlingMonthlyCredit(readBlingMonthlyCredit([period], "2026-01-24"), [2173, 2172, 2390]);
    expect(result.itemsInCents).toEqual([27, 27, 30]);
    expect(result.totalInCents).toBe(84);
    expect(result.message).toContain("R$ 0,84, CORRESPONDENTE À ALÍQUOTA DE 1,25%");
    expect(calculateBlingMonthlyCredit({ ...readBlingMonthlyCredit([period], "2026-01-24"), rate: 50 }, [1, 1]).totalInCents).toBe(2);
  });
  it.each([[], [-1], [0.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]].map(bases => ({ bases })))("rejects unreviewable bases $bases", ({ bases }) => {
    expect(() => calculateBlingMonthlyCredit(readBlingMonthlyCredit([period], "2026-01-24"), bases)).toThrow("fiscal_credit_base_required");
  });
});
