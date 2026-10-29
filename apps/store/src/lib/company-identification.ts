import { z } from "zod";

export type CompanyIdentification = {
  legalName: string;
  tradeName: string | null;
  taxId: string;
  address: string;
  email: string | null;
  phone: string | null;
  supportChannel: string | null;
};

const optionalText = z.string().trim().max(300).nullable().optional().transform((value) => value || null);

const rowsSchema = z.array(
  z.object({
    legal_name: z.string().trim().min(3).max(200),
    trade_name: optionalText,
    tax_id: z.string().regex(/^\d{14}$/u),
    address: z.string().trim().min(5).max(400),
    email: optionalText,
    phone: optionalText,
    support_channel: optionalText
  })
);

export function formatCnpj(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/u, "$1.$2.$3/$4-$5");
}

export function parseCompanyIdentification(data: unknown): CompanyIdentification | null {
  const parsed = rowsSchema.safeParse(data ?? []);
  const row = parsed.success ? parsed.data[0] : undefined;
  if (!row) return null;
  return {
    legalName: row.legal_name,
    tradeName: row.trade_name,
    taxId: row.tax_id,
    address: row.address,
    email: row.email,
    phone: row.phone,
    supportChannel: row.support_channel
  };
}
