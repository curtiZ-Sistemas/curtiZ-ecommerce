type Environment = Readonly<Record<string, string | undefined>>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;

// Wrangler currently resets this API setting during upload. Reapply and verify it
// immediately after the official deployment, without modifying Worker bindings.
export async function protectWorkerQueryStrings(environment: Environment, transport: typeof fetch = fetch): Promise<void> {
  const account = environment.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = environment.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const target = environment.DEPLOY_TARGET;
  if (!/^[a-f0-9]{32}$/iu.test(account) || !token || (target !== "store" && target !== "panel")) {
    throw new Error("Configuração de observabilidade do Worker inválida.");
  }
  const worker = target === "store" ? "curtiz-ecommerce" : "curtiz-painel";
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/script-settings`;
  const request = async (method: "GET" | "PATCH", body?: RecordValue): Promise<RecordValue> => {
    const attempts = method === "GET" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let retryable = method === "GET";
      try {
        const response = await transport(url, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        retryable = method === "GET" && (response.status === 429 || response.status >= 500);
        const payload = record(await response.json());
        const result = record(payload?.result);
        if (!response.ok || payload?.success !== true || !result) throw new Error();
        return result;
      } catch {
        // Provider bodies and transport errors may contain sensitive context.
        if (!retryable || attempt + 1 === attempts) throw new Error("Não foi possível configurar a proteção dos logs do Worker.");
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw new Error("Não foi possível configurar a proteção dos logs do Worker.");
  };
  const current = await request("GET");
  const observability = record(current.observability);
  if (!observability) throw new Error("Configuração de observabilidade indisponível.");
  if (observability.redact_query_string === true) return;
  await request("PATCH", { observability: { ...observability, redact_query_string: true } });
  // Reconcile bounded stale/transient reads; never repeat the PATCH or accept
  // successful transport as proof that the privacy setting actually persisted.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verified = await request("GET");
    if (record(verified.observability)?.redact_query_string === true) return;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  throw new Error("A remoção de query strings dos logs não foi confirmada.");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/cloudflare-observability.ts")) {
  void protectWorkerQueryStrings(process.env).then(() => {
    console.info("Remoção de query strings dos logs do Worker confirmada.");
  }).catch(() => {
    console.error("Falha ao confirmar a proteção dos logs do Worker após o deploy.");
    process.exitCode = 1;
  });
}
