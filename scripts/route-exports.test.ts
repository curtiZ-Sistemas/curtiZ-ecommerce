import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// O Next valida as exportações de route.ts no build; uma função auxiliar exportada quebra o typecheck do build.
const allowedExports = new Set([
  "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS",
  "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration",
  "generateStaticParams"
]);

const routeFiles = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  if (statSync(path).isDirectory()) return routeFiles(path);
  return name === "route.ts" || name === "route.tsx" ? [path] : [];
});

describe("exportações de route handlers", () => {
  it("route.ts da loja e do painel exportam somente handlers e configurações do Next", () => {
    const violations = ["apps/store/src/app", "apps/panel/src/app"].flatMap((root) =>
      routeFiles(resolve(process.cwd(), root)).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gmu)]
          .map((match) => match[1] ?? "");
        return names.filter((name) => !allowedExports.has(name))
          .map((name) => `${relative(process.cwd(), file).replaceAll("\\", "/")}: ${name}`);
      })
    );
    expect(violations).toEqual([]);
  });
});
