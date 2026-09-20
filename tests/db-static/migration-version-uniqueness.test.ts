import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("versionamento das migrations", () => {
  it("mantém uma versão por arquivo e preserva a ordem até o Melhor Envio", () => {
    const names = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
    const versions = names.map((name) => name.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
    expect(names).toContain("202609140004_customer_order_history_retention.sql");
    expect(names).toContain("202609140009_payment_webhook_leases.sql");
    expect(names).toContain("202609160003_melhor_envio_shipping.sql");
    expect(versions.indexOf("202609140004")).toBeLessThan(versions.indexOf("202609140009"));
    expect(versions.indexOf("202609140009")).toBeLessThan(versions.indexOf("202609160003"));
  });
});
