export const PROMOTION_BAR_MESSAGE_LIMIT = 3;

export type PromotionBarMessage = {
  id: string;
  text: string;
  active: boolean;
  sortOrder: number;
  href?: string;
  cta?: string;
  startsAt?: string;
  endsAt?: string;
};

function validDateBoundary(value: string | undefined, now: number, boundary: "start" | "end") {
  if (!value) return true;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return boundary === "start" ? timestamp <= now : timestamp > now;
}

export function selectCurrentPromotionBarMessages(
  messages: readonly PromotionBarMessage[],
  now = Date.now()
): PromotionBarMessage[] {
  return messages
    .filter(
      (message) =>
        message.active &&
        validDateBoundary(message.startsAt, now, "start") &&
        validDateBoundary(message.endsAt, now, "end")
    )
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .slice(0, PROMOTION_BAR_MESSAGE_LIMIT);
}
