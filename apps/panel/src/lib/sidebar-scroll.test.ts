import { describe, expect, it } from "vitest";
import {
  keepActiveItemVisible,
  panelSidebarScrollKey,
  readSidebarScroll,
  writeSidebarScroll
} from "./sidebar-scroll";

describe("sidebar scroll", () => {
  it("isola a posição por painel e restaura valores válidos", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const adminKey = panelSidebarScrollKey("administracao");
    writeSidebarScroll(storage, adminKey, 850.4);
    expect(readSidebarScroll(storage, adminKey)).toBe(850);
    expect(readSidebarScroll(storage, panelSidebarScrollKey("gerencia"))).toBe(0);
  });

  it("só ajusta a posição quando o item ativo ficaria fora da área visível", () => {
    expect(keepActiveItemVisible(800, 400, 850, 42)).toBe(800);
    expect(keepActiveItemVisible(800, 400, 1240, 42)).toBe(894);
    expect(keepActiveItemVisible(800, 400, 760, 42)).toBe(748);
  });
});
