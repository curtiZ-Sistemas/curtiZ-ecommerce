import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const store = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/.pnpm");
const load = createRequire(import.meta.url);
const allowedVersions = ["2.3.2", "4.0.7"];
const versions = new Set<string>();
type GlobCompiler = {
  (pattern: string): (path: string) => boolean;
  parse: (pattern: string, options: { noextglob: boolean; noext: boolean }) => unknown;
  makeRe: (pattern: string, options: { noextglob: boolean; noext: boolean }) => RegExp;
};

for (const folder of readdirSync(store)) {
  if (!folder.startsWith("picomatch@")) continue;
  const packagePath = resolve(store, folder, "node_modules/picomatch");
  const { version } = load(resolve(packagePath, "package.json")) as { version: string };
  assert.ok(allowedVersions.includes(version), `Review the picomatch patch for ${version}`);
  const picomatch = load(packagePath) as GlobCompiler;

  // Test the parser and explicit regex compilation with harmless sample patterns.
  for (const method of [picomatch.parse, picomatch.makeRe]) {
    for (const operator of ["+", "*"]) {
      assert.throws(
        () => method(`${operator}(fixture)`, { noextglob: false, noext: false }),
        { name: "SyntaxError", message: "Repeated extglobs are disabled by the security patch" }
      );
    }
  }
  assert.equal(picomatch("**/*.{ts,tsx}")("src/fixture.tsx"), true);
  assert.equal(picomatch("src/@(test|spec).ts")("src/test.ts"), true);
  versions.add(version);
}

assert.deepEqual([...versions].sort(), allowedVersions);
console.log(`Verified the picomatch mitigation in all installed copies: ${[...versions].sort().join(", ")}`);
