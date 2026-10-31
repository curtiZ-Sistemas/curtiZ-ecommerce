import { describe, expect, it } from "vitest";

import { isDevtoolsShortcut } from "./devtools-guard";

const keys = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
});

describe("isDevtoolsShortcut", () => {
  it("detects the DevTools shortcuts", () => {
    expect(isDevtoolsShortcut(keys("F12"))).toBe(true);
    expect(isDevtoolsShortcut(keys("I", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(keys("j", { metaKey: true, altKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(keys("u", { ctrlKey: true }))).toBe(true);
  });

  it("keeps ordinary shortcuts working", () => {
    expect(isDevtoolsShortcut(keys("c", { ctrlKey: true }))).toBe(false);
    expect(isDevtoolsShortcut(keys("i"))).toBe(false);
    expect(isDevtoolsShortcut(keys("F5"))).toBe(false);
  });
});
