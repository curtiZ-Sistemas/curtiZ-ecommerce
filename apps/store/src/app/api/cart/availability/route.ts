import { readJsonResponse } from "@curtiz/security";
import { logServerEvent } from "@curtiz/security";
import { NextResponse } from "next/server";
import { z } from "zod";

import { demoProducts } from "@/lib/catalog";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { publicBudgetResponse } from "@/lib/public-request";
import { createPublicSupabaseClient } from "@/lib/supabase/server";
import { readRows, readString } from "@/lib/unknown-data";
import { safeDatabaseError } from "../../../../lib/checkout-diagnostics";

const headers = { "cache-control": "no-store" };
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requestSchema = z.object({
  variantIds: z.array(z.string().trim().min(1).max(180)).max(50)
});
const uuidArraySchema = z.array(z.string().uuid()).max(50);

type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const requestIdFor = (request: Request) => {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  return requestIdPattern.test(incoming) ? incoming : crypto.randomUUID();
};

const json = (requestId: string, body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { ...headers, "x-request-id": requestId }
  });

const getDemoAvailability = (variantIds: string[]) =>
  variantIds.map((variantId) => ({
    variantId,
    available: demoProducts.some((product) =>
      product.colors.some((color) =>
        product.sizes.some((size) => `${product.id}:${color}:${size}` === variantId)
      )
    )
  }));

function databaseError(value: unknown): DatabaseError {
  return safeDatabaseError(value);
}

function logFailure(requestId: string, code: string, error?: unknown) {
  const details = databaseError(error);
  logServerEvent("error", "cart_availability_request_failed", {
    requestId,
    code,
    message: details.message ?? null,
    details: details.details ?? null,
    hint: details.hint ?? null,
    databaseCode: details.code ?? null
  });
}

const isMissingAvailabilityMigration = (error: DatabaseError) =>
  error.code === "PGRST202" || error.code === "42883";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!isAllowedRequestOrigin(request)) {
      return json(requestId, { error: "origin_not_allowed", requestId }, 403);
    }

    const budget = await publicBudgetResponse(request, "availability");
    if (budget) return budget;

    const boundedBody = await readJsonResponse(request, 32768);
    if (boundedBody instanceof Response) return boundedBody;
    const parsed = requestSchema.safeParse(boundedBody);
    if (!parsed.success) {
      return json(requestId, { error: "invalid_request", requestId }, 400);
    }

    const variantIds = [...new Set(parsed.data.variantIds)];
    if (variantIds.length === 0) return json(requestId, { items: [], requestId });
    if (process.env.DEMO_MODE === "true") {
      return json(requestId, { items: getDemoAvailability(variantIds), requestId });
    }

    const ids = uuidArraySchema.safeParse(variantIds);
    if (!ids.success) {
      return json(requestId, { error: "invalid_variant_ids", requestId }, 400);
    }

    // A public request needs only this narrowly granted RPC. It must not depend
    // on service_role or expose direct inventory relations.
    const supabase = createPublicSupabaseClient();
    if (!supabase) {
      logFailure(requestId, "SUPABASE_PUBLIC_CONFIGURATION_MISSING");
      return json(requestId, {
        error: "availability_configuration_missing",
        requestId
      }, 503);
    }

    const result = await supabase.rpc("cart_variant_stock_availability", {
      p_variant_ids: ids.data
    });
    if (result.error) {
      const error = databaseError(result.error);
      const code = isMissingAvailabilityMigration(error)
        ? "AVAILABILITY_MIGRATION_REQUIRED"
        : "AVAILABILITY_QUERY_FAILED";
      logFailure(requestId, code, result.error);
      return json(requestId, {
        error: code === "AVAILABILITY_MIGRATION_REQUIRED"
          ? "availability_migration_required"
          : "availability_query_failed",
        requestId
      }, 503);
    }

    const rows = readRows(result.data);
    const byId = new Map(rows.flatMap((row) => {
      const variantId = readString(row, "variantId");
      return variantId && typeof row.available === "boolean"
        ? [[variantId, row] as const]
        : [];
    }));
    if (byId.size !== ids.data.length || ids.data.some((id) => !byId.has(id))) {
      logFailure(requestId, "AVAILABILITY_INVALID_RESULT");
      return json(requestId, { error: "availability_invalid_result", requestId }, 503);
    }

    return json(requestId, {
      items: ids.data.map((variantId) => {
        const row = byId.get(variantId);
        const unavailableAt = row ? readString(row, "unavailableAt") : "";
        return {
          variantId,
          available: row?.available === true,
          ...(unavailableAt ? { unavailableAt } : {})
        };
      }),
      requestId
    });
  } catch (error) {
    logFailure(requestId, "AVAILABILITY_RUNTIME_FAILURE", error);
    return json(requestId, {
      error: "availability_service_unavailable",
      requestId
    }, 503);
  }
}
