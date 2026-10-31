import { describe, expect, it, vi } from "vitest";
import { consumePanelMutationBudget, panelRateLimitStatus } from "./api-rate-limit";

describe("panel rate-limit feedback", () => {
  it.each([[false, null, 429], [null, {}, 503], [null, null, 503]])("reports shared denial as %s", async (data, error, status) => {
    const request = new Request("https://panel.test/api", { method: "POST" });
    expect(await consumePanelMutationBudget(request, { rpc: async () => ({ data, error }) })).toBe(false);
    expect(panelRateLimitStatus(request)).toBe(status);
  });
  it("does not consume mutation budgets on GET", async () => {
    const request = new Request("https://panel.test/api");
    const rpc = vi.fn();
    expect(await consumePanelMutationBudget(request, { rpc })).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
