import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Exercise the exact transitive copies selected by the security overrides.
describe("security dependency compatibility", () => {
  it("keeps Sharp usable through Miniflare with real WebP encoding and decoding", async () => {
    const wrangler = createRequire(realpathSync(new URL("../node_modules/wrangler/package.json", import.meta.url)));
    const miniflare = createRequire(wrangler.resolve("miniflare"));
    type SharpFactory = (input: Uint8Array | { create: { width: number; height: number; channels: number; background: string } }) => {
      webp(): { toBuffer(): Promise<Buffer> };
      metadata(): Promise<{ width?: number; height?: number; format?: string }>;
    };
    const sharp = miniflare("sharp") as unknown as SharpFactory;
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).webp().toBuffer();
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ width: 1, height: 1, format: "webp" });
  });

  it("preserves the adm-zip API consumed by rclone without writing files", () => {
    const rclone = createRequire(realpathSync(new URL("../node_modules/rclone.js/package.json", import.meta.url)));
    type ZipConstructor = new (bytes?: Buffer) => {
      addFile(name: string, bytes: Buffer): void;
      toBuffer(): Buffer;
      readAsText(name: string): string;
    };
    const Zip = rclone("adm-zip") as unknown as ZipConstructor;
    const archive = new Zip();
    archive.addFile("fixture.txt", Buffer.from("security-check"));
    expect(new Zip(archive.toBuffer()).readAsText("fixture.txt")).toBe("security-check");
  });
});
