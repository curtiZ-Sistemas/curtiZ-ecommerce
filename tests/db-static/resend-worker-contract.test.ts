import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("Resend deployment contract", () => {
  it("retains the store cron and existing queues with isolation", () => {
    const worker = readFileSync("apps/store/custom-worker.ts", "utf8");
    for (const queue of ["expiration", "bling", "shipping", "transactional_email"]) expect(worker).toContain(`runQueue("${queue}"`);
    expect(worker).toContain("context.waitUntil");
    const wrangler = readFileSync("apps/store/wrangler.jsonc", "utf8");
    expect(wrangler.match(/\*\/5 \* \* \* \*/gu)).toHaveLength(2);
    expect(wrangler).toContain('"keep_vars": true');
    expect(wrangler).not.toMatch(/EMAIL_ENABLED|RESEND_API_KEY|EMAIL_FROM/u);
  });
  it("keeps runtime email values out of deploy overrides and build secrets", () => {
    for (const app of ["store", "panel"]) {
      const pkg = JSON.parse(readFileSync(`apps/${app}/package.json`, "utf8")) as { scripts: Record<string, string> };
      expect(pkg.scripts["deploy:production"]).toContain("--keep-vars");
      expect(pkg.scripts["deploy:staging"]).toContain("--keep-vars");
    }
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("EMAIL_PROVIDER: disabled"); expect(workflow).toContain('EMAIL_ENABLED: "false"');
    expect(workflow).not.toContain("secrets.RESEND_API_KEY");
    expect(readFileSync("apps/store/src/lib/transactional-email-jobs.ts", "utf8")).not.toContain("process.env");
  });
});
