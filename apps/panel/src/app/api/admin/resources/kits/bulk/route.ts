import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeAdminRequest,
  objectRows,
  privateNoStore,
  readPanelJson,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { adminResources } from "@/lib/admin-resources";
import { normalizedSlug, normalizeKitGradePrices } from "@/lib/kit-grade-normalize";

export const dynamic = "force-dynamic";

const maximumKitsPerRequest = 60;

const bulkSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().trim().min(1).max(150),
      gradeSource: z.string().max(250)
    }).catchall(z.unknown())
  ).min(1).max(maximumKitsPerRequest)
});

type BulkOutcome = { name: string; status: "created" | "skipped" | "error"; message?: string };

function failure(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: privateNoStore });
}

async function authorizeKitWrite(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, ["admin", "manager"]);
  if (!auth) return { response: unauthorizedAdminResponse(request) };
  const writePermission = adminResources.kits.writePermission;
  if (!writePermission) return { response: failure("Esta área é somente leitura.", 405) };
  const permission = await auth.supabase.rpc("has_permission", { permission_code: writePermission });
  if (permission.error) return { response: failure("Não foi possível confirmar suas permissões agora.", 503) };
  if (permission.data !== true) return { response: failure("Sua permissão não permite esta operação.", 403) };
  return { auth };
}

// Lists the reference colors that already have a kit, so the quick registration can mark them.
export async function GET(request: NextRequest) {
  const { auth, response } = await authorizeKitWrite(request);
  if (!auth) return response;
  const existing = await auth.supabase
    .from("kits")
    .select("grade_product_id,grade_color")
    .is("deleted_at", null)
    .not("grade_product_id", "is", null)
    .limit(2000);
  if (existing.error) return failure("Não foi possível verificar os kits existentes.", 503);
  return NextResponse.json(
    { items: objectRows(existing.data).map(row => ({ productId: row.grade_product_id, color: row.grade_color })) },
    { headers: privateNoStore }
  );
}

// Creates one active kit per reference color. Colors that already have a kit are skipped, so repeating it is safe.
export async function POST(request: NextRequest) {
  const { auth, response } = await authorizeKitWrite(request);
  if (!auth) return response;

  const body = await readPanelJson(request, 256 * 1024);
  if (body instanceof NextResponse) return body;
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return failure("Revise os kits informados.", 400);

  const outcomes: BulkOutcome[] = [];
  const candidates: { name: string; values: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  for (const item of parsed.data.items) {
    const values: Record<string, unknown> = {};
    const errors = normalizeKitGradePrices(values, item, true);
    const slug = normalizedSlug(item.name).slice(0, 150).replace(/-$/u, "");
    if (errors || !slug) {
      outcomes.push({ name: item.name, status: "error", message: errors ? Object.values(errors)[0] : "Use letras ou números no nome." });
      continue;
    }
    const key = `${String(values.grade_product_id)}|${String(values.grade_color)}`;
    if (seen.has(key)) {
      outcomes.push({ name: item.name, status: "skipped", message: "Cor repetida no pedido." });
      continue;
    }
    seen.add(key);
    values.name = item.name;
    values.slug = slug;
    values.description = "";
    values.active = true;
    values.created_by = auth.userId;
    candidates.push({ name: item.name, values });
  }

  if (candidates.length > 0) {
    const productIds = [...new Set(candidates.map(candidate => String(candidate.values.grade_product_id)))];
    const existing = await auth.supabase
      .from("kits")
      .select("grade_product_id,grade_color")
      .is("deleted_at", null)
      .in("grade_product_id", productIds);
    if (existing.error) return failure("Não foi possível verificar os kits existentes.", 503);
    const taken = new Set(
      objectRows(existing.data).map(row => `${String(row.grade_product_id)}|${String(row.grade_color)}`)
    );

    for (const candidate of candidates) {
      const key = `${String(candidate.values.grade_product_id)}|${String(candidate.values.grade_color)}`;
      if (taken.has(key)) {
        outcomes.push({ name: candidate.name, status: "skipped", message: "Já existe um kit para esta cor." });
        continue;
      }
      let result = await auth.supabase.from("kits").insert(candidate.values).select("id").single();
      if (result.error?.code === "23505") {
        result = await auth.supabase
          .from("kits")
          .insert({ ...candidate.values, slug: `${String(candidate.values.slug)}-${crypto.randomUUID().replace(/-/gu, "").slice(0, 20)}` })
          .select("id")
          .single();
      }
      if (result.error) {
        outcomes.push({
          name: candidate.name,
          status: "error",
          message: result.error.message === "invalid_kit_grade_source"
            ? "O produto de referência precisa ter um SKU avulso ativo de cada tamanho de 34 a 39."
            : "Não foi possível criar este kit."
        });
      } else {
        outcomes.push({ name: candidate.name, status: "created" });
      }
    }
  }

  const count = (status: BulkOutcome["status"]) => outcomes.filter(outcome => outcome.status === status).length;
  const created = count("created");
  return NextResponse.json(
    {
      created,
      skipped: count("skipped"),
      failed: count("error"),
      outcomes,
      message: `${created} kit(s) criado(s), ${count("skipped")} já existente(s), ${count("error")} com erro.`
    },
    { status: created > 0 ? 201 : 200, headers: privateNoStore }
  );
}
