declare module "exceljs/lib/xlsx/xform/base-xform" {
  type SaxEvent =
    | { eventType: "opentag"; value: { name: string; attributes: Record<string, unknown>; [key: string]: unknown } }
    | { eventType: "closetag"; value: { name: string; [key: string]: unknown } }
    | { eventType: "text"; value: string };

  export default class BaseXform {
    model: unknown;
    parseOpen(value: Extract<SaxEvent, { eventType: "opentag" }>["value"]): void;
    parseText(value: string): void;
    parseClose(name: string): boolean;
    parse(parser: AsyncIterable<SaxEvent[]>): Promise<unknown>;
  }
}
