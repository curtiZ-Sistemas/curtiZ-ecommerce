import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const privateName = /secret|password|private|access_?token|refresh_?token|service_?role|encryption|credential|api_?key/iu;
export function browserLeakCategories(source: string, environment: NodeJS.ProcessEnv = {}): string[] {
  const findings: string[] = [];
  if (/sourceMappingURL\s*=\s*(?:data:|\S+\.map\b)/u.test(source)) findings.push("browser_source_map_reference");
  if (/sb_secret_[a-zA-Z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/u.test(source)) findings.push("private_credential");
  for (const match of source.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/gu)) {
    try {
      const claims = JSON.parse(Buffer.from(match[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
      if (claims.role === "service_role") { findings.push("privileged_database_key"); break; }
    } catch { /* Non-JWT strings do not establish a credential leak. */ }
  }
  if (/GoTrueClient|RealtimeClient|createBrowserSupabaseClient|postgres_changes/u.test(source)) findings.push("supabase_browser_client");
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("NEXT_PUBLIC_") && privateName.test(name) && value && value.length >= 12 && source.includes(value)) {
      findings.push("private_environment_value");
      break;
    }
  }
  return findings;
}

export function scanBrowserAssets(directory: string, environment: NodeJS.ProcessEnv = process.env): string[] {
  const root = resolve(directory);
  if (!existsSync(root)) return ["browser_assets_missing"];
  const findings: string[] = [];
  let scripts = 0;
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isSymbolicLink()) { findings.push("browser_asset_symlink"); continue; }
      if (entry.isDirectory()) { visit(file); continue; }
      const name = relative(root, file);
      if (entry.name.endsWith(".map")) findings.push(`${name}: browser_source_map`);
      if (/\.(?:js|html|json|css)$/u.test(entry.name)) {
        if (entry.name.endsWith(".js")) scripts += 1;
        for (const category of browserLeakCategories(readFileSync(file, "utf8"), environment)) findings.push(`${name}: ${category}`);
      }
    }
  };
  visit(root);
  if (!scripts) findings.push("browser_scripts_missing");
  return findings;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/check-browser-exposure.ts")) {
  const findings = process.argv[2] ? scanBrowserAssets(process.argv[2]) : ["browser_asset_path_required"];
  if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
  else console.info("Browser assets: no prohibited exposure detected.");
}
