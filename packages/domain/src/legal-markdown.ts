export { legalInlineTokens, type LegalInline } from "./legal-inline";
export function legalMarkdownBlocks(value: string) {
  return value
    .split(/\n\s*\n/u)
    .filter((block) => block.trim())
    .flatMap<{ type: "ol" | "ul" | "heading" | "p"; start: number; lines: string[] }>((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^\s*(?:[-*]|\d+[.)])\s+/u.test(line))) {
        return [
          {
            type: /^\s*\d/u.test(lines[0]!) ? ("ol" as const) : ("ul" as const),
            start: Number(/^\s*(\d+)/u.exec(lines[0]!)?.[1] ?? 1),
            lines: lines.map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, ""))
          }
        ];
      }
      if (/^#{1,6}\s/u.test(block))
        return [{ type: "heading" as const, start: 1, lines: [block.replace(/^#{1,6}\s/u, "")] }];
      return [{ type: "p" as const, start: 1, lines: [block] }];
    });
}
