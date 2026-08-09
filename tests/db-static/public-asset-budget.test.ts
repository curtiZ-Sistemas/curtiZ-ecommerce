import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "apps/store/public/images";
const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });

describe("public storefront asset budget", () => {
  const sizes = files(root).map((path) => ({ path, bytes: statSync(path).size }));

  it("keeps every source image below the current 2.5 MiB ceiling", () => {
    const largest = sizes.reduce<{ path: string; bytes: number } | undefined>(
      (current, asset) => (!current || asset.bytes > current.bytes ? asset : current),
      undefined
    );
    expect(largest?.bytes, largest?.path).toBeLessThanOrEqual(2.5 * 1024 * 1024);
  });

  it("prevents the source image inventory from growing past 21 MiB", () => {
    expect(sizes.reduce((total, asset) => total + asset.bytes, 0)).toBeLessThanOrEqual(
      21 * 1024 * 1024
    );
  });
});
