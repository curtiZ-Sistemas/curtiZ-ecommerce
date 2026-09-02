import type { ActivityLog } from "./activity-logs";
import { actionLabels, actorLabel, moduleLabel, originLabel } from "./activity-logs";

function safeCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function buildActivityWorkbook(items: ActivityLog[], periodLabel: string) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "curti Z";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Logs de atividades", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Data e hora (São Paulo)", key: "date", width: 23 },
    { header: "Responsável", key: "actor", width: 28 },
    { header: "Perfil", key: "role", width: 16 },
    { header: "Origem", key: "origin", width: 14 },
    { header: "Ação", key: "action", width: 18 },
    { header: "Módulo", key: "module", width: 20 },
    { header: "Entidade", key: "entity", width: 24 },
    { header: "Identificador", key: "id", width: 38 },
    { header: "Descrição", key: "description", width: 46 },
    { header: "Campos alterados", key: "fields", width: 36 }
  ];
  const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
  for (const item of items) {
    sheet.addRow({
      date: dateTime.format(new Date(item.created_at)),
      actor: safeCell(actorLabel(item)),
      role: item.actor_role ?? "—",
      origin: originLabel(item.origin_type),
      action: actionLabels[item.action_type],
      module: moduleLabel(item.module),
      entity: safeCell(item.entity_label || item.entity_type),
      id: item.entity_id ?? "—",
      description: safeCell(item.description),
      fields: safeCell(item.changed_fields.join(", "))
    });
  }
  sheet.autoFilter = { from: "A1", to: "J1" };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C251E" } };
  sheet.properties.defaultRowHeight = 20;
  sheet.addRow([]);
  sheet.addRow([`Período: ${safeCell(periodLabel)}`]);

  return workbook;
}

export async function exportActivityWorkbook(items: ActivityLog[], periodLabel: string) {
  const workbook = await buildActivityWorkbook(items, periodLabel);
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `logs-de-atividades-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
