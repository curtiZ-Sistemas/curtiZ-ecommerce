/** Browser-safe path validation; importing it must not pull server secrets or Node APIs. */
export const safeInternalPath = (value: string | null | undefined, fallback = "/"): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")
    || Array.from(value).some((character) => character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) {
    return fallback;
  }
  return value;
};
