export type UnknownRecord = Record<string, unknown>;

export const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readString = (
  record: UnknownRecord,
  key: string,
  fallback = ""
): string => (typeof record[key] === "string" ? record[key] : fallback);

export const readRows = (value: unknown): UnknownRecord[] =>
  Array.isArray(value) ? value.filter(isUnknownRecord) : [];

export const readNumber = (
  record: UnknownRecord,
  key: string,
  fallback = 0
): number => {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const readQueryResult = (value: unknown): { data: unknown; error: unknown } => {
  if (!isUnknownRecord(value)) return { data: null, error: "invalid_response" };
  return { data: value.data ?? null, error: value.error ?? null };
};
