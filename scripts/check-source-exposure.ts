import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { prohibitedPublicName, publicEnvironmentErrors } from "./public-environment";

export function checkSourceExposure(root = process.cwd()): string[] {
  const findings = [...publicEnvironmentErrors(process.env)];
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  if (tracked.some((file) => file.startsWith(".playwright-mcp/"))) findings.push("forbidden_tracked_browser_artifacts");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "apps", "packages", "scripts", ".github"], { cwd: root, encoding: "utf8" })
    .split("\0").filter((file) => /\.(?:ts|tsx|mjs|json|yml)$/u.test(file)
      && !/(?:node_modules|\.next|\.open-next|dist|build)\/|\.test\.|\.d\.ts$/u.test(file) && existsSync(resolve(root, file)));
  const sources = new Map<string, string>();
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    sources.set(resolve(root, file), source);
    // The checker deliberately contains forbidden-name fixtures/patterns, never values.
    if (!file.startsWith("scripts/")) {
      for (const name of new Set(source.match(/NEXT_PUBLIC_[A-Z0-9_]+/gu) ?? [])) {
        if (prohibitedPublicName(name)) findings.push(`${file}: prohibited_public_configuration`);
      }
    }
  }
  const runtimeImports = (file: string, source: string) => {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        if (!(bindings && ts.isNamedImports(bindings) && !node.importClause?.name && bindings.elements.every((e) => e.isTypeOnly))) imports.push(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require")
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return imports;
  };
  const resolveImport = (file: string, specifier: string): string | undefined => {
    let base: string;
    if (specifier.startsWith(".")) base = resolve(dirname(file), specifier);
    else if (specifier.startsWith("@/")) {
      const app = file.replaceAll("\\", "/").match(/\/apps\/(store|panel)\//u)?.[1];
      if (!app) return;
      base = resolve(root, "apps", app, "src", specifier.slice(2));
    } else if (specifier.startsWith("@curtiz/")) {
      const [name, ...subpath] = specifier.slice(8).split("/");
      if (!name) return;
      const pkg = JSON.parse(readFileSync(resolve(root, "packages", name, "package.json"), "utf8")) as { exports: Record<string, string> };
      const entry = pkg.exports[subpath.length ? `./${subpath.join("/")}` : "."];
      if (!entry) return;
      base = resolve(root, "packages", name, entry);
    } else return;
    return [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")].find((candidate) => sources.has(candidate));
  };
  const visited = new Set<string>();
  const visitClient = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = sources.get(file);
    if (!source || /^\s*["']use server["'];/u.test(source)) return;
    const label = file.slice(root.length + 1).replaceAll("\\", "/");
    if (/\bconsole\s*\./u.test(source)) findings.push(`${label}: client_console`);
    if (/process\.env\.(?:SUPABASE_|[A-Z_]*(?:SECRET|ACCESS_TOKEN|PRIVATE_KEY|PASSWORD))/u.test(source)) findings.push(`${label}: private_client_configuration`);
    for (const specifier of runtimeImports(file, source)) {
      if (specifier === "server-only" || specifier.startsWith("@supabase/") || specifier === "@curtiz/integrations") {
        findings.push(`${label}: privileged_client_import`); continue;
      }
      const dependency = resolveImport(file, specifier);
      if (dependency) visitClient(dependency);
    }
  };
  for (const [file, source] of sources) if (/^\s*["']use client["'];/u.test(source)) visitClient(file);
  return [...new Set(findings)];
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/check-source-exposure.ts")) {
  const findings = checkSourceExposure();
  if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
  else console.info("Source boundaries and public configuration passed.");
}
