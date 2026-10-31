const terminalOrderStatuses = new Set(["cancelled", "refunded"]);

export const isOperationallyActiveOrder = (status: string) =>
  !terminalOrderStatuses.has(status);
