import { describe, expect, it } from "vitest";
import {
  PROMOTION_BAR_MESSAGE_LIMIT,
  selectCurrentPromotionBarMessages,
  type PromotionBarMessage
} from "./store-campaigns";

const message = (
  id: string,
  overrides: Partial<PromotionBarMessage> = {}
): PromotionBarMessage => ({
  id,
  text: `Mensagem ${id}`,
  active: true,
  sortOrder: Number(id),
  ...overrides
});

describe("campanhas da barra promocional", () => {
  it("aceita de zero a três mensagens e respeita a ordem", () => {
    expect(selectCurrentPromotionBarMessages([])).toEqual([]);
    expect(selectCurrentPromotionBarMessages([message("1")])).toHaveLength(1);
    expect(
      selectCurrentPromotionBarMessages([
        message("3"),
        message("1"),
        message("2"),
        message("4")
      ]).map((item) => item.id)
    ).toEqual(["1", "2", "3"]);
    expect(PROMOTION_BAR_MESSAGE_LIMIT).toBe(3);
  });

  it("omite mensagens inativas, futuras e expiradas", () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    expect(
      selectCurrentPromotionBarMessages(
        [
          message("1", { active: false }),
          message("2", { startsAt: "2026-08-24T00:00:00.000Z" }),
          message("3", { endsAt: "2026-08-23T11:59:59.000Z" }),
          message("4", {
            startsAt: "2026-08-23T00:00:00.000Z",
            endsAt: "2026-08-24T00:00:00.000Z"
          })
        ],
        now
      ).map((item) => item.id)
    ).toEqual(["4"]);
  });
});
