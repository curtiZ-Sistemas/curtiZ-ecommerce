import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeManagerRequest,
  managerNoStore,
  safeManagerOrigin,
  unauthorizedManagerResponse
} from "@/lib/manager-api";

export const dynamic = "force-dynamic";

const dateValue = z.string().date();
const uuid = z.string().uuid();
const moneyCents = z.number().int().positive().max(999_999_999_999);
const optionalText = (length: number) => z.string().trim().max(length).optional().default("");

const baseAccountRecord = z.object({
  party: z.string().trim().min(2).max(160),
  description: z.string().trim().min(2).max(240),
  category_id: uuid,
  issued_on: dateValue,
  due_on: dateValue,
  document_number: optionalText(100),
  amount_cents: moneyCents,
  account_id: z.union([uuid, z.literal("")]).default(""),
  notes: optionalText(2000)
});

const actionSchemas = {
  "account.save": z.object({
    id: z.union([uuid, z.literal("")]).default(""),
    name: z.string().trim().min(2).max(80),
    initial_balance_cents: z.number().int().min(-999_999_999_999).max(999_999_999_999),
    active: z.boolean().optional()
  }),
  "category.save": z.object({
    id: z.union([uuid, z.literal("")]).default(""),
    name: z.string().trim().min(2).max(80),
    kind: z.enum(["income", "expense", "both"]),
    active: z.boolean().optional()
  }),
  "group.save": z.object({
    id: z.union([uuid, z.literal("")]).default(""),
    name: z.string().trim().min(2).max(100),
    expected_percentage: z.number().min(0).max(100),
    active: z.boolean().optional()
  }),
  "partner.save": z.object({
    id: z.union([uuid, z.literal("")]).default(""),
    name: z.string().trim().min(2).max(100),
    group_id: uuid,
    active: z.boolean().optional()
  }),
  "receivable.create": baseAccountRecord
    .extend({
      installment_count: z.number().int().min(1).max(120),
      interval_days: z.number().int().min(1).max(365)
    })
    .refine((value) => value.amount_cents >= value.installment_count, {
      message: "O valor total precisa comportar todas as parcelas."
    }),
  "payable.create": baseAccountRecord
    .extend({
      installment_count: z.number().int().min(1).max(120),
      interval_days: z.number().int().min(1).max(365)
    })
    .refine((value) => value.amount_cents >= value.installment_count, {
      message: "O valor total precisa comportar todas as parcelas."
    }),
  "receivable.update": baseAccountRecord.extend({ id: uuid }),
  "payable.update": baseAccountRecord.extend({ id: uuid }),
  "receivable.settle": z.object({ id: uuid, settled_on: dateValue, account_id: uuid }),
  "payable.settle": z.object({ id: uuid, settled_on: dateValue, account_id: uuid }),
  "receivable.reverse": z.object({ id: uuid, reason: z.string().trim().min(3).max(500) }),
  "payable.reverse": z.object({ id: uuid, reason: z.string().trim().min(3).max(500) }),
  "receivable.delete": z.object({ id: uuid }),
  "payable.delete": z.object({ id: uuid }),
  "transaction.save": z.object({
    id: z.union([uuid, z.literal("")]).default(""),
    type: z.enum(["income", "expense"]),
    description: z.string().trim().min(2).max(240),
    category_id: z.union([uuid, z.literal("")]).default(""),
    account_id: uuid,
    amount_cents: moneyCents,
    occurred_on: dateValue,
    notes: optionalText(2000)
  }),
  "transaction.delete": z.object({
    id: uuid,
    reason: z.string().trim().min(3).max(500).optional()
  }),
  "contribution.save": z
    .object({
      id: z.union([uuid, z.literal("")]).default(""),
      partner_id: z.union([uuid, z.literal("")]).default(""),
      group_id: z.union([uuid, z.literal("")]).default(""),
      account_id: uuid,
      category_id: z.union([uuid, z.literal("")]).default(""),
      contributed_on: dateValue,
      amount_cents: moneyCents,
      description: z.string().trim().min(2).max(240),
      notes: optionalText(2000)
    })
    .refine((value) => Boolean(value.partner_id) !== Boolean(value.group_id), {
      message: "Selecione um sócio ou um grupo."
    }),
  "export.log": z.object({
    scope: z.enum(["all", "receivables", "payables", "transactions", "contributions"]),
    from: dateValue,
    to: dateValue
  })
} as const;

type FinancialAction = keyof typeof actionSchemas;

function isFinancialAction(value: string): value is FinancialAction {
  return Object.hasOwn(actionSchemas, value);
}

function defaultPeriod() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export async function GET(request: NextRequest) {
  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo?.roles.includes("manager")) {
    return NextResponse.json(
      { demo: true, data: null, canExport: false },
      { headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  const fallback = defaultPeriod();
  const period = z.object({ from: dateValue, to: dateValue }).safeParse({
    from: request.nextUrl.searchParams.get("from") ?? fallback.from,
    to: request.nextUrl.searchParams.get("to") ?? fallback.to
  });
  if (!period.success) {
    return NextResponse.json(
      { message: "Revise o período selecionado." },
      { status: 400, headers: managerNoStore }
    );
  }

  const [snapshot, exportPermission] = await Promise.all([
    auth.supabase.rpc("financial_control_snapshot", {
      p_date_from: period.data.from,
      p_date_to: period.data.to
    }),
    auth.supabase.rpc("has_permission", { permission_code: "reports.export" })
  ]);

  if (snapshot.error) {
    return NextResponse.json(
      { message: "Não foi possível consolidar o financeiro agora." },
      { status: 503, headers: managerNoStore }
    );
  }
  const snapshotData: unknown = snapshot.data;

  return NextResponse.json(
    {
      data: snapshotData,
      canExport: !exportPermission.error && exportPermission.data === true
    },
    { headers: managerNoStore }
  );
}

export async function POST(request: NextRequest) {
  if (!safeManagerOrigin(request)) {
    return NextResponse.json(
      { message: "Origem da requisição não autorizada." },
      { status: 403, headers: managerNoStore }
    );
  }

  const demo = verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  if (demo) {
    return NextResponse.json(
      { message: "O modo de demonstração não altera dados financeiros." },
      { status: 403, headers: managerNoStore }
    );
  }

  const auth = await authorizeManagerRequest(request);
  if (!auth) return unauthorizedManagerResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const envelope = z.object({ action: z.string(), payload: z.unknown() }).safeParse(body);
  if (!envelope.success || !isFinancialAction(envelope.data.action)) {
    return NextResponse.json(
      { message: "Ação financeira inválida." },
      { status: 400, headers: managerNoStore }
    );
  }

  const payload = actionSchemas[envelope.data.action].safeParse(envelope.data.payload);
  if (!payload.success) {
    return NextResponse.json(
      { message: payload.error.issues[0]?.message ?? "Revise os dados informados." },
      { status: 400, headers: managerNoStore }
    );
  }

  if (envelope.data.action === "export.log") {
    const permission = await auth.supabase.rpc("has_permission", {
      permission_code: "reports.export"
    });
    if (permission.error || permission.data !== true) {
      return NextResponse.json(
        { message: "Sua permissão não permite exportar o financeiro." },
        { status: 403, headers: managerNoStore }
      );
    }
  }

  const result = await auth.supabase.rpc("financial_control_mutate", {
    p_action: envelope.data.action,
    p_payload: payload.data
  });
  if (result.error) {
    return NextResponse.json(
      { message: "A operação não foi concluída. Confira o estado atual e tente novamente." },
      { status: 409, headers: managerNoStore }
    );
  }
  const resultData: unknown = result.data;

  return NextResponse.json({ data: resultData }, { headers: managerNoStore });
}
