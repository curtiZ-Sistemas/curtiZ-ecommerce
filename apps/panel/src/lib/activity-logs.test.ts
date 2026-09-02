import { describe, expect, it } from "vitest";
import { activityDiff, actorLabel, displayAuditValue, moduleLabel, type ActivityLog } from "./activity-logs";

const baseLog: ActivityLog = {
  id: "00000000-0000-4000-8000-000000000001",
  actor_id: null,
  actor_name_snapshot: null,
  actor_email_snapshot: null,
  actor_role: null,
  action: "payments.update",
  action_type: "UPDATE",
  module: "financeiro",
  entity_type: "payments",
  entity_id: null,
  entity_label: null,
  description: "Pagamento alterado",
  origin_type: "system",
  origin_name: "Mercado Pago",
  previous_data_sanitized: { status: "pending", authorization: "segredo" },
  new_data_sanitized: { status: "paid", authorization: "segredo novo" },
  metadata_sanitized: null,
  changed_fields: ["status", "authorization"],
  reason: null,
  request_id: null,
  ip_hash: null,
  user_agent_summary: null,
  created_at: "2026-09-02T12:00:00Z"
};

describe("activity log presentation", () => {
  it("diferencia atores de sistema e humaniza módulos", () => {
    expect(actorLabel(baseLog)).toBe("Mercado Pago");
    expect(moduleLabel(baseLog.module)).toBe("Financeiro");
  });

  it("destaca antes e depois sem exibir chaves sensíveis", () => {
    const diff = activityDiff(baseLog);
    expect(diff.find((item) => item.field === "status")).toEqual({ field: "status", before: "pending", after: "paid" });
    expect(displayAuditValue(diff.find((item) => item.field === "authorization")?.after)).toBe("[REDACTED]");
  });
});
