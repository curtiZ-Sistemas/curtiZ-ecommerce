import { isUnknownRecord, readString } from "./unknown-data";

export type CartSyncFailure = {
  category: "authorization" | "dependency" | "invalid_data" | "internal";
  error: "cart_forbidden" | "cart_sync_failed" | "cart_sync_unavailable" | "invalid_cart_data";
  status: 403 | 422 | 500 | 503;
};

export function cartSyncErrorCode(error: unknown): string {
  return isUnknownRecord(error) ? readString(error, "code", "unknown") : "unknown";
}

export function isMissingCartSyncRpc(error: unknown): boolean {
  return ["42883", "PGRST202"].includes(cartSyncErrorCode(error));
}

export function classifyCartSyncFailure(error: unknown): CartSyncFailure {
  const code = cartSyncErrorCode(error);
  if (["42501", "PGRST301"].includes(code)) {
    return { category: "authorization", error: "cart_forbidden", status: 403 };
  }
  if (["22023", "22P02", "23503", "23514"].includes(code)) {
    return { category: "invalid_data", error: "invalid_cart_data", status: 422 };
  }
  if (code.startsWith("PGRST") || code === "57014") {
    return { category: "dependency", error: "cart_sync_unavailable", status: 503 };
  }
  return { category: "internal", error: "cart_sync_failed", status: 500 };
}
