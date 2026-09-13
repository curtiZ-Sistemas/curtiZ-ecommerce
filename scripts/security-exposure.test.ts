import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicEnvironmentErrors } from "./public-environment";
import { browserLeakCategories, scanBrowserAssets } from "./check-browser-exposure";

describe("security exposure gates", () => {
  it.each(["SECRET", "PASSWORD", "PRIVATE_KEY", "ACCESS_TOKEN", "REFRESH_TOKEN", "SERVICE_ROLE", "CLIENT_SECRET", "WEBHOOK_SECRET", "ENCRYPTION", "CREDENTIAL", "SUPABASE_URL"])("rejects public %s without printing its value", (concept) => {
    const result = publicEnvironmentErrors({ [`NEXT_PUBLIC_${concept}`]: "must-never-be-printed" });
    expect(result).toHaveLength(1);
    expect(result.join()).not.toContain("must-never-be-printed");
  });
  it("allows SDK keys that are actually public", () => {
    expect(publicEnvironmentErrors({ NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: "public", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public" })).toEqual([]);
  });
  it("detects injected private values and SDK code without echoing credentials", () => {
    expect(browserLeakCategories('const value="test-only-private-value";', { SUPABASE_SECRET_KEY: "test-only-private-value" }))
      .toEqual(["private_environment_value"]);
    expect(browserLeakCategories("class RealtimeClient {} // postgres_changes")).toContain("supabase_browser_client");
    expect(browserLeakCategories("//# sourceMappingURL=data:application/json;base64,test")).toContain("browser_source_map_reference");
    const legacyKey = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"service_role"}').toString("base64url")}.testsignature`;
    expect(browserLeakCategories(legacyKey)).toEqual(["privileged_database_key"]);
  });
  it("fails for missing bundles and even orphaned source maps, but accepts ordinary public assets", () => {
    const directory = mkdtempSync(join(tmpdir(), "curtiz-assets-"));
    try {
      expect(scanBrowserAssets(join(directory, "missing"))).toContain("browser_assets_missing");
      mkdirSync(join(directory, "chunks"));
      writeFileSync(join(directory, "chunks", "app.js"), 'const publicKey = "TEST-public";');
      expect(scanBrowserAssets(directory, {})).toEqual([]);
      writeFileSync(join(directory, "chunks", "orphan.map"), "{}");
      expect(scanBrowserAssets(directory, {}).join()).toContain("browser_source_map");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
