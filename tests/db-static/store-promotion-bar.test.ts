import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608230001_store_promotion_bar.sql",
  "utf8"
).toLowerCase();
const api = readFileSync("apps/panel/src/app/api/promotion-bar/route.ts", "utf8");

describe("barra promocional da loja", () => {
  it("limita três mensagens ativas também no banco", () => {
    expect(migration).toContain("enforce_store_campaign_message_limit");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(") >= 3 then");
  });

  it("expõe ao público somente conteúdo vigente e sem metadados administrativos", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("current_store_promotion_messages");
    expect(migration).toContain("message.starts_at is null or message.starts_at <= now()");
    expect(migration).toContain("message.ends_at is null or message.ends_at > now()");
    expect(migration).not.toContain("grant select on public.store_campaign_messages to anon");
    expect(migration).toContain("grant select on public.current_store_promotion_messages to anon");
  });

  it("restringe edição a perfis autorizados e valida a origem da mutação", () => {
    expect(migration).toContain("'promotion_bar.manage'");
    expect(migration).toContain("('admin'::public.app_role), ('manager'::public.app_role)");
    expect(migration).not.toContain("('operational'::public.app_role)");
    expect(migration).toContain("perform private.require_permission('promotion_bar.manage')");
    expect(api).toContain('permission_code: "promotion_bar.manage"');
    expect(api).toContain("safePanelOrigin(request)");
  });
});
