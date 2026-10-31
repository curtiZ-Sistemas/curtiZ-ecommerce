export type LegalInline = { text: string; bold?: boolean; italic?: boolean; href?: string };
export function safeLegalLink(value: string): string | undefined {
  if (
    /^\/(?!\/)/u.test(value) &&
    !value.includes("\\") &&
    !/\s/u.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  )
    return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function legalInlineTokens(value: string): LegalInline[] {
  const tokens: LegalInline[] = [];
  const pattern =
    /\\([\\*`])|\*\*\*((?:\\.|[^*])+)\*\*\*|\*\*((?:\\.|[^*])+)\*\*|\*((?:\\.|[^*])+)\*|\[([^\]\n]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>]+)/gu;
  const unescape = (text: string) => text.replace(/\\([\\*`])/gu, "$1");
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ text: value.slice(cursor, match.index) });
    if (match[1]) tokens.push({ text: match[1] });
    else if (match[2]) tokens.push({ text: unescape(match[2]), bold: true, italic: true });
    else if (match[3]) tokens.push({ text: unescape(match[3]), bold: true });
    else if (match[4]) tokens.push({ text: unescape(match[4]), italic: true });
    else if (match[5])
      tokens.push(
        ...legalInlineTokens(match[5]).map((token) => ({
          ...token,
          href: safeLegalLink(match[6]!)
        }))
      );
    else if (match[7]) {
      const url = match[7].replace(/[.,;]+$/u, "");
      tokens.push({ text: url, href: safeLegalLink(url) });
      if (url.length !== match[7].length) tokens.push({ text: match[7].slice(url.length) });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) tokens.push({ text: value.slice(cursor) });
  return tokens;
}
