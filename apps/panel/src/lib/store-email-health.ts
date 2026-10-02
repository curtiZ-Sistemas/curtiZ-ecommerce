export function getStoreEmailService(value: unknown, now = Date.now()) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const checkedAt = typeof row?.checked_at === "string" ? row.checked_at : null;
  if (!row || !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || now - Date.parse(checkedAt) > 15 * 60_000)
    return { name: "Resend", state: "unavailable" as const, detail: "Sem verificação recente do Worker da loja. Confira o agendamento.", checkedAt };
  const labels: Record<string, string> = { email_disabled: "Envio desativado na loja", email_configuration_missing: "Configuração incompleta na loja",
    email_processing_failed: "Há falhas na fila de e-mails; consulte as tarefas técnicas" };
  const state = row.state === "online" ? "configured" as const : row.state === "degraded" ? "degraded" as const : "not_configured" as const;
  const label = typeof row.error_summary === "string" ? labels[row.error_summary] : undefined;
  return { name: "Resend", state, detail: label ?? "Worker da loja configurado; aceitação e entrega são verificadas separadamente", checkedAt };
}
