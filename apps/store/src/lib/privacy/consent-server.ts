import type { NextRequest } from "next/server";

export function hasServerConsent(
  request: NextRequest,
  category: "preferences" | "analytics" | "marketing"
) {
  const raw = request.cookies.get("curtiz-cookie-preferences")?.value;
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const categories = parsed as Record<string, unknown>;
    if (category === "preferences")
      return categories.preferences === true || categories.functional === true;
    return categories[category] === true;
  } catch {
    return false;
  }
}
