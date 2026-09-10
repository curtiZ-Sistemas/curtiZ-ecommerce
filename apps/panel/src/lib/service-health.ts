/** An HTTP probe proves reachability only, never a successful purchase. */
export function httpServiceState(status: number, latencyMs: number): "online" | "degraded" | "offline" {
  if (status >= 200 && status < 300) return latencyMs > 2_000 ? "degraded" : "online";
  if (status >= 300 && status < 400) return "degraded";
  return "offline";
}

export function backupStatus(provider: string | undefined): string {
  return provider?.trim()
    ? "Provedor informado; cópias e restauração ainda não verificadas"
    : "Backup não verificado; consulte o provedor e mantenha uma cópia independente";
}
