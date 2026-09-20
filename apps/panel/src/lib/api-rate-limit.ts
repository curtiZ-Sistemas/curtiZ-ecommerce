type RateClient = { rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }> };
type RateLimitFailure = {
  status: number;
  code?: string;
  message?: string;
  details?: string;
};
const denials = new WeakMap<Request, RateLimitFailure>();

const errorDetails = (value: unknown): Omit<RateLimitFailure, "status"> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const error = value as Record<string, unknown>;
  return {
    code: typeof error.code === "string" ? error.code.slice(0, 40) : undefined,
    message: typeof error.message === "string" ? error.message.slice(0, 180) : undefined,
    details: typeof error.details === "string" ? error.details.slice(0, 180) : undefined
  };
};

export function panelRateLimitStatus(request?: Request): number {
  return request ? denials.get(request)?.status ?? 401 : 401;
}

export function panelRateLimitFailure(request: Request): RateLimitFailure | null {
  return denials.get(request) ?? null;
}

export async function consumePanelMutationBudget(request: Request, client: RateClient): Promise<boolean> {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  try {
    const budget = await client.rpc("consume_private_api_rate_limit", { p_scope: "admin_mutation" });
    if (budget.error || typeof budget.data !== "boolean") {
      denials.set(request, { status: 503, ...errorDetails(budget.error) });
      return false;
    }
    if (!budget.data) { denials.set(request, { status: 429, code: "RATE_LIMITED" }); return false; }
    return true;
  } catch (error) {
    denials.set(request, { status: 503, ...errorDetails(error) });
    return false;
  }
}
