import type { CartLine } from "@curtiz/domain";

export const unavailableRetentionMs = 3 * 24 * 60 * 60_000;
type Availability = { variantId: string; available: boolean; unavailableAt?: string | null };
export function parseCartAvailability(value: unknown): Availability[] | null {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) return null;
  const valid = (item: unknown): item is Availability => Boolean(item && typeof item === "object" && "variantId" in item && typeof item.variantId === "string" && "available" in item && typeof item.available === "boolean" && (!("unavailableAt" in item) || item.unavailableAt === null || (typeof item.unavailableAt === "string" && Number.isFinite(Date.parse(item.unavailableAt)))));
  return value.items.every(valid) ? value.items : null;
}
export function retainCartLines(lines: CartLine[], now = Date.now()) {
  return lines.filter((line) => !line.unavailableAt || (
    Number.isFinite(Date.parse(line.unavailableAt)) && now - Date.parse(line.unavailableAt) < unavailableRetentionMs
  ));
}
export function applyCartAvailability(lines: CartLine[], entries: Availability[], now = Date.now()) {
  const availability = new Map(entries.map((item) => [item.variantId, item]));
  return retainCartLines(lines.map((line) => {
    const item = availability.get(line.variantId);
    if (item?.available !== false) return line;
    const timestamp = item.unavailableAt ?? line.unavailableAt ?? new Date(now).toISOString();
    return { ...line, unavailableAt: timestamp };
  }), now);
}
