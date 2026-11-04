export type PostalAddress = Partial<Record<"street" | "district" | "city" | "state", string>>;
type Field = { value: string };
type Fields = Partial<Record<keyof PostalAddress, Field>>;
type Status = "idle" | "loading" | "found" | "partial" | "missing" | "unavailable";

export function createPostalCodeLookup(getFields: () => Fields, setStatus: (status: Status) => void,
  options: { initialCode?: string; replaceUntouchedOnChange?: boolean } = {}) {
  let serial = 0;
  let controller: AbortController | undefined;
  let lastCode = "";
  let filled: PostalAddress = {};
  const edited = new Set<keyof PostalAddress>();
  const revisions: Record<keyof PostalAddress, number> = { street: 0, district: 0, city: 0, state: 0 };
  const initialCode = options.initialCode?.replace(/\D/gu, "") ?? "";
  const originalFields = getFields();
  const original = Object.fromEntries(Object.entries(originalFields).map(([key, field]) => [key, field?.value ?? ""]));

  const update = async (value: string) => {
    const code = value.replace(/\D/gu, "");
    const request = ++serial;
    controller?.abort();
    if (code !== lastCode) {
      const fields = getFields();
      for (const key of Object.keys(filled) as (keyof PostalAddress)[]) {
        if (fields[key]?.value === filled[key]) fields[key]!.value = "";
      }
      filled = {};
      lastCode = code;
    }
    if (code.length !== 8) { setStatus("idle"); return; }
    const fields = getFields();
    const initial = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field?.value ?? ""]));
    const initialRevisions = { ...revisions };
    controller = new AbortController();
    const activeController = controller;
    const timer = setTimeout(() => activeController.abort(), 8000);
    setStatus("loading");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${code}/json/`, { signal: activeController.signal, credentials: "omit" });
      if (!response.ok) throw new Error("lookup failed");
      const data: unknown = await response.json();
      if (request !== serial) return;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid response");
      const record = data as Record<string, unknown>;
      if (record.erro === true || record.erro === "true") { setStatus("missing"); return; }
      const mapping = { street: "logradouro", district: "bairro", city: "localidade", state: "uf" } as const;
      const limits = { street: 160, district: 100, city: 100, state: 2 } as const;
      let complete = true;
      for (const key of Object.keys(mapping) as (keyof PostalAddress)[]) {
        const result = record[mapping[key]];
        const text = typeof result === "string" ? result.trim() : "";
        const field = fields[key];
        if (!text || text.length > limits[key] || (key === "state" && !/^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/u.test(text))) {
          complete = false;
          continue;
        }
        const replaceOriginal = options.replaceUntouchedOnChange && initialCode !== code && field?.value === original[key];
        if (field && !edited.has(key) && revisions[key] === initialRevisions[key] && field.value === initial[key]
          && (!field.value.trim() || replaceOriginal)) {
          field.value = text;
          filled[key] = text;
        }
      }
      setStatus(complete ? "found" : "partial");
    } catch {
      if (request === serial) setStatus("unavailable");
    } finally { clearTimeout(timer); }
  };
  return { update, markEdited: (key: keyof PostalAddress) => { edited.add(key); revisions[key]++; delete filled[key]; },
    dispose: () => { serial++; controller?.abort(); } };
}
