export type ManagementPeriodPreset =
  | "today"
  | "7days"
  | "30days"
  | "month"
  | "previous"
  | "year"
  | "custom";

export const managementPeriodOptions: Array<{
  value: ManagementPeriodPreset;
  label: string;
}> = [
  { value: "today", label: "Hoje" },
  { value: "7days", label: "7 dias" },
  { value: "30days", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "previous", label: "Mês anterior" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Personalizado" }
];

const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo"
});

export function managementToday(now = new Date()) {
  return saoPauloDate.format(now);
}

export function managementPeriodFor(
  preset: Exclude<ManagementPeriodPreset, "custom">,
  today = managementToday()
) {
  const end = new Date(`${today}T12:00:00Z`);
  const from = new Date(end);

  if (preset === "today") return { from: today, to: today };
  if (preset === "7days") from.setUTCDate(from.getUTCDate() - 6);
  if (preset === "30days") from.setUTCDate(from.getUTCDate() - 29);
  if (preset === "month") from.setUTCDate(1);
  if (preset === "previous") {
    from.setUTCMonth(from.getUTCMonth() - 1, 1);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === "year") from.setUTCMonth(0, 1);

  return { from: from.toISOString().slice(0, 10), to: today };
}
