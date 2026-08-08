import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080006_help_center_reform.sql"),
  "utf8"
);

describe("help center reform migration", () => {
  it("separa permissões editoriais, atendimento e acesso técnico", () => {
    for (const permission of [
      "support_content.view",
      "support_content.create",
      "support_content.edit",
      "support_content.review",
      "support_content.publish",
      "support_ticket.view",
      "support_ticket.assign",
      "support_ticket.reply",
      "support_ticket.close",
      "support_settings.manage"
    ])
      expect(sql).toContain(`'${permission}'`);
    expect(sql).not.toMatch(/\('technical','support_content\./u);
  });

  it("mantém rascunhos separados e versões publicadas imutáveis", () => {
    expect(sql).toContain("default 'draft'");
    expect(sql).toContain("published_version_id");
    expect(sql).toContain("scheduled_version_id");
    expect(sql).toContain("published help versions are immutable");
    expect(sql).toContain("public.published_help_contents");
    expect(sql).toContain("content.status='published'");
    expect(sql).toContain("- 'author_id' - 'reviewer_id' - 'attachments'");
  });

  it("protege busca, feedback, chamados e anexos", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toContain("record_help_search");
    expect(sql).toContain("record_help_feedback");
    expect(sql).toContain("rate_limit_support_write");
    expect(sql).toContain("support participants read attachment files");
    expect(sql).toContain("support participants create attachment metadata");
  });

  it("mantém decisões sensíveis no servidor e com auditoria", () => {
    expect(sql).toContain("author cannot approve own content");
    expect(sql).toContain("private.require_permission('support_content.publish')");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("reopen_own_support_conversation");
    expect(sql).toContain("set_support_priority");
  });
});
