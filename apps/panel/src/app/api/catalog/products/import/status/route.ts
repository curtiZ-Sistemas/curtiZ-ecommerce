import { logServerEvent, postgresUuidSchema } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { authorizeAdminRequest, privateNoStore, unauthorizedAdminResponse } from "@/lib/admin-api";
import { enqueueProductImportImages } from "@/lib/product-import-queue";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth) return unauthorizedAdminResponse(request);
  const parsed = postgresUuidSchema.safeParse(request.nextUrl.searchParams.get("runId"));
  if (!parsed.success) return NextResponse.json({ message: "Execução de importação inválida." }, { status: 400, headers: privateNoStore });
  const status = await auth.supabase.rpc("get_product_import_status", { p_run_id: parsed.data });
  if (status.error) {
    const missing = status.error.code === "P0002";
    return NextResponse.json({
      message: missing ? "Execução de importação não encontrada." : "Não foi possível consultar o progresso da importação.",
      code: missing ? "IMPORT_RUN_NOT_FOUND" : "IMPORT_STATUS_UNAVAILABLE"
    }, { status: missing ? 404 : 503, headers: privateNoStore });
  }
  const payload = status.data && typeof status.data === "object" && !Array.isArray(status.data)
    ? { ...status.data as Record<string, unknown> }
    : {};
  const queueJobs = Array.isArray(payload.queueJobs) ? payload.queueJobs : [];
  delete payload.queueJobs;
  const messages = queueJobs.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const job = item as Record<string, unknown>;
    const jobId = postgresUuidSchema.safeParse(job.jobId);
    const productId = postgresUuidSchema.safeParse(job.productId);
    return jobId.success && productId.success
      ? [{ jobId: jobId.data, productId: productId.data, runId: parsed.data }]
      : [];
  });
  try {
    await enqueueProductImportImages(messages);
  } catch {
    logServerEvent("error", "panel_product_import_recovery_queue_failed", {
      runId: parsed.data, code: "QUEUE_UNAVAILABLE"
    });
  }
  return NextResponse.json(payload, { headers: privateNoStore });
}
