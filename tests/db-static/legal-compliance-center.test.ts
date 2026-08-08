import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608080005_legal_compliance_center.sql"),
  "utf8"
);

describe("legal compliance center migration", () => {
  it("separa edição, revisão, publicação e acesso técnico", () => {
    expect(sql).toContain("('legal_content.edit'");
    expect(sql).toContain("('legal_content.review'");
    expect(sql).toContain("('legal_content.publish'");
    expect(sql).not.toMatch(/select 'operational'.*legal_content/isu);
    expect(sql).not.toMatch(/select 'technical'.*legal_content/isu);
    expect(sql).toContain("private.require_permission(review_permission)");
  });

  it("mantém versões publicadas imutáveis e esconde dados internos", () => {
    expect(sql).toContain("published legal versions are immutable");
    expect(sql).toContain("content_hash");
    expect(sql).toContain("published_legal_documents");
    expect(sql).toContain("- 'responsible_id' - 'reviewer_id'");
    expect(sql).toContain("company.completeness_status <> 'complete'");
  });

  it("registra cookies e solicitações sem liberar escrita direta", () => {
    expect(sql).toContain("record_cookie_consent");
    expect(sql).toContain("submit_privacy_request");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke insert,update,delete,truncate");
    expect(sql).toContain("identity_status");
  });

  it("cria apenas minutas e não publica placeholders automaticamente", () => {
    expect(sql).toContain("default 'draft'");
    expect(sql).toContain("MINUTA: exige preenchimento");
    expect(sql).toContain("Não publicar com placeholders");
    expect(sql).not.toContain("status = 'published' -- seed");
  });
});
