import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080004_banner_review_management.sql"),
  "utf8"
);

describe("banner and review management migration", () => {
  it("limita banners simultâneos inclusive em agendamentos concorrentes", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("tstzrange");
    expect(sql).toContain("if active_count >= 4");
    expect(sql).toContain("status in ('published', 'scheduled')");
  });

  it("restringe upload de banner ao caminho, formato e permissão corretos", () => {
    expect(sql).toContain("(storage.foldername(name))[1] = 'banners'");
    expect(sql).toContain("private.has_permission('banners.update')");
    expect(sql).toContain("lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')");
    expect(sql).toContain("banner_external_hosts");
    expect(sql).toContain("external banner host is not authorized");
  });

  it("preserva histórico de moderação sem liberar escrita direta", () => {
    expect(sql).toContain("alter table public.review_moderation_history force row level security");
    expect(sql).toContain("private.has_permission('reviews.manage')");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.review_moderation_history from anon, authenticated");
    expect(sql).toContain("set search_path = ''");
  });
});
