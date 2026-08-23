import { z } from "zod";

const safeCopy = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[<>]/u.test(value), "HTML não é permitido.");

const optionalCopy = (maximum: number) => safeCopy(maximum).nullable();
const optionalDateTime = z.string().datetime({ offset: true }).nullable();
const isSafeInternalPath = (value: string) =>
  /^\/(?!\/)/u.test(value) &&
  !/[\\<>"]/u.test(value) &&
  ![...value].some((character) => character.charCodeAt(0) < 32);

export const promotionBarMutationSchema = z
  .object({
    id: z.string().uuid().optional(),
    text: safeCopy(140).refine((value) => value.length >= 4),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
    href: z
      .string()
      .trim()
      .max(500)
      .refine(
        isSafeInternalPath,
        "Use um caminho interno iniciado por uma barra."
      )
      .nullable(),
    cta: optionalCopy(40),
    startsAt: optionalDateTime,
    endsAt: optionalDateTime
  })
  .superRefine((value, context) => {
    if (value.cta && !value.href) {
      context.addIssue({
        code: "custom",
        path: ["cta"],
        message: "Informe um link para usar um CTA."
      });
    }
    if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "O término deve ocorrer depois do início."
      });
    }
  });

export const promotionBarReorderSchema = z.object({
  action: z.literal("reorder"),
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
});

export type PromotionBarMutation = z.infer<typeof promotionBarMutationSchema>;
