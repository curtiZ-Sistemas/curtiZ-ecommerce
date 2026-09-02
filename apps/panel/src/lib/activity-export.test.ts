import { describe, expect, it } from "vitest";
import { buildActivityWorkbook } from "./activity-export";
import type { ActivityLog } from "./activity-logs";

describe("activity log export", () => {
  it("gera XLSX real e neutraliza fórmulas em conteúdo controlado por usuário", async () => {
    const item = {
      id: "00000000-0000-4000-8000-000000000001",
      actor_id: "00000000-0000-4000-8000-000000000002",
      actor_name_snapshot: "=HYPERLINK(\"https://example.invalid\")",
      actor_email_snapshot: null,
      actor_role: "manager",
      action: "report.exported",
      action_type: "EXPORT",
      module: "sistema",
      entity_type: "audit_logs",
      entity_id: null,
      entity_label: null,
      description: "Exportação solicitada",
      origin_type: "person",
      origin_name: null,
      previous_data_sanitized: null,
      new_data_sanitized: null,
      metadata_sanitized: null,
      changed_fields: [],
      reason: null,
      request_id: null,
      ip_hash: null,
      user_agent_summary: null,
      created_at: "2026-09-02T12:00:00Z"
    } satisfies ActivityLog;
    const workbook = await buildActivityWorkbook([item], "2026-09-01 a 2026-09-02");
    const sheet = workbook.getWorksheet("Logs de atividades");
    expect(sheet?.getCell("B2").value).toBe("'=HYPERLINK(\"https://example.invalid\")");
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    expect(bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
  }, 20_000);
});
