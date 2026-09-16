type RateClient = { rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }> };
const denials = new WeakMap<Request, number>();

export function panelRateLimitStatus(request?: Request): number {
  return request ? denials.get(request) ?? 401 : 401;
}

export async function consumePanelMutationBudget(request: Request, client: RateClient): Promise<boolean> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  try {
    const budget = await client.rpc("consume_private_api_rate_limit", { p_scope: "admin_mutation" });
    if (budget.error || typeof budget.data !== "boolean") { denials.set(request, 503); return false; }
    if (!budget.data) { denials.set(request, 429); return false; }
    return true;
  } catch {
    denials.set(request, 503);
    return false;
  }
}
