import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const store = resolve(root, "apps/store");
const wranglerRequire = createRequire(realpathSync(resolve(root, "node_modules/wrangler/package.json")));
const nextRequire = createRequire(resolve(store, "package.json"));
const esbuild = wranglerRequire("esbuild") as {
  build(options: {
    absWorkingDir: string;
    stdin: { contents: string; resolveDir: string };
    alias: Record<string, string>;
    bundle: boolean;
    write: boolean;
    format: string;
    platform: string;
  }): Promise<{ outputFiles: { text: string }[] }>;
};

type WorkerConfig = {
  main: string;
  alias?: Record<string, string>;
  assets: { binding: string };
  env: Record<string, { name: string; triggers?: { crons: string[] } }>;
};
const config = (app: string) => ts.parseConfigFileTextToJson(
  "wrangler.jsonc", readFileSync(resolve(root, `apps/${app}/wrangler.jsonc`), "utf8")
).config as WorkerConfig;

describe("Worker server-only boundary", () => {
  it("Wrangler resolves the store marker and still executes the importing module", async () => {
    const result = await esbuild.build({
      absWorkingDir: store,
      stdin: {
        contents: 'import "server-only"; globalThis.importExecuted = true; export const job = () => "executed";',
        resolveDir: store
      },
      alias: config("store").alias ?? {},
      bundle: true,
      write: false,
      format: "cjs",
      platform: "browser"
    });
    const module = { exports: {} as { job?: () => string } };
    const context = { module, exports: module.exports, importExecuted: false };
    runInNewContext(result.outputFiles[0]?.text ?? "", context);
    expect(context.importExecuted).toBe(true);
    expect(module.exports.job?.()).toBe("executed");
  });

  it("Next.js retains its client rejection and empty server marker", () => {
    const compiler = nextRequire("next/dist/build/create-compiler-aliases") as {
      createServerOnlyClientOnlyAliases(server: boolean): Record<string, string>;
    };
    const client = compiler.createServerOnlyClientOnlyAliases(false)["server-only$"];
    const server = compiler.createServerOnlyClientOnlyAliases(true)["server-only$"];
    expect(client).toBeDefined();
    expect(server).toBeDefined();
    expect(() => { runInNewContext(readFileSync(nextRequire.resolve(client ?? ""), "utf8")); })
      .toThrow("This module cannot be imported from a Client Component");
    expect(readFileSync(nextRequire.resolve(server ?? ""), "utf8").trim()).toBe("");
    for (const app of ["store", "panel"]) {
      expect(readFileSync(resolve(root, `apps/${app}/next.config.ts`), "utf8"))
        .not.toMatch(/worker-server-only|["']server-only["']/u);
    }
    expect(config("panel").alias).toBeUndefined();
  });

  it("keeps independent entrypoints, assets and store crons", () => {
    const storeConfig = config("store");
    const panelConfig = config("panel");
    expect(storeConfig.main).toBe("custom-worker.ts");
    expect(panelConfig.main).toBe(".open-next/worker.js");
    expect(storeConfig.env.production?.name).not.toBe(panelConfig.env.production?.name);
    for (const environment of ["staging", "production"]) {
      expect(storeConfig.env[environment]?.triggers?.crons).toEqual(["*/5 * * * *"]);
    }
    for (const app of ["store", "panel"]) {
      const manifest = JSON.parse(readFileSync(resolve(root, `apps/${app}/package.json`), "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(config(app).assets.binding).toBe("ASSETS");
      expect(manifest.scripts["deploy:dry-run"])
        .toContain("wrangler deploy --dry-run --config wrangler.jsonc --env production --keep-vars");
    }
  });
});
