export type ProductDescriptionBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const listLine = /^\s*(?:[✔✓•]|[-–—])\s*(.+)$/u;

export function parseProductDescription(value: string): ProductDescriptionBlock[] {
  const blocks: ProductDescriptionBlock[] = [];
  let items: string[] = [];
  const flushList = () => {
    if (items.length) blocks.push({ type: "list", items });
    items = [];
  };

  for (const rawLine of value.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const match = line.match(listLine);
    if (match?.[1]) {
      items.push(match[1].trim());
      continue;
    }
    flushList();
    blocks.push({ type: "paragraph", text: line });
  }
  flushList();
  return blocks;
}
