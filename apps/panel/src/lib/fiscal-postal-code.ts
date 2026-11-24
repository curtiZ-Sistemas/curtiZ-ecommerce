export type PostalAddress = Partial<Record<"street" | "district" | "city" | "state", string>>;
export type PostalLookupResult = { status: "found" | "partial"; address: PostalAddress } | { status: "missing" | "failed" };
export type PostalLookupState = "idle" | "loading" | PostalLookupResult["status"];

// Mesmo serviço público usado no checkout, sem cookies ou chaves de API.
export async function lookupFiscalPostalCode(code: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<PostalLookupResult> {
  if (!/^\d{8}$/u.test(code)) return { status: "missing" };
  try {
    const response = await transport("https://viacep.com.br/ws/" + code + "/json/", {
      signal, credentials: "omit", redirect: "error", cache: "no-store"
    });
    if (!response.ok) return { status: "failed" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: "failed" };
    const data = payload as Record<string, unknown>;
    if (data.erro === true || data.erro === "true") return { status: "missing" };
    if (typeof data.cep !== "string" || data.cep.replace(/\D/gu, "") !== code) return { status: "failed" };
    const address: PostalAddress = {};
    const mapping = { street: "logradouro", district: "bairro", city: "localidade", state: "uf" } as const;
    const limits = { street: 180, district: 100, city: 100, state: 2 } as const;
    for (const key of Object.keys(mapping) as (keyof PostalAddress)[]) {
      const raw = data[mapping[key]];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value && value.length <= limits[key] && (key !== "state" || /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/u.test(value))) address[key] = value;
    }
    if (!address.city || !address.state) return { status: "failed" };
    return { status: address.street && address.district ? "found" : "partial", address };
  } catch { return { status: "failed" }; }
}

// Campos preenchidos ou corrigidos pelo operador têm prioridade.
export function mergePostalAddress<T extends Record<keyof PostalAddress, string>>(buyer: T, address: PostalAddress): T {
  return { ...buyer, street: buyer.street || address.street || "", district: buyer.district || address.district || "",
    city: buyer.city || address.city || "", state: buyer.state || address.state || "" };
}
