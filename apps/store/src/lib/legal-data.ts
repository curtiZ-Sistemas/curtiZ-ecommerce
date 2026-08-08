import { createServerSupabaseClient } from "./supabase/server";

type RecordValue = Record<string, unknown>;
export type PublicLegalSection = { number: string; title: string; content: string };
export type PublicLegalReference = {
  name: string;
  relatedArticle?: string;
  officialUrl: string;
  consultedOn: string;
};
export type PublicLegalDocument = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  type: string;
  language: string;
  versionId: string;
  version: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  publishedAt: string;
  sections: PublicLegalSection[];
  references: PublicLegalReference[];
  company: Record<string, string>;
};

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}
function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.flatMap((item) => (record(item) ? [record(item)!] : [])) : [];
}
function text(item: RecordValue | null, key: string) {
  return typeof item?.[key] === "string" ? item[key] : "";
}
function numeric(item: RecordValue | null, key: string) {
  return typeof item?.[key] === "number" ? item[key] : 0;
}

function mapDocument(row: RecordValue): PublicLegalDocument | null {
  const snapshot = record(row.snapshot);
  const companyRecord = record(snapshot?.company);
  const id = text(row, "document_id");
  const slug = text(row, "slug");
  const title = text(row, "public_title");
  if (!id || !slug || !title || !snapshot) return null;
  const company = Object.fromEntries(
    Object.entries(companyRecord ?? {}).flatMap(([key, value]) =>
      typeof value === "string" && value ? [[key, value]] : []
    )
  );
  return {
    id,
    slug,
    title,
    summary: text(row, "summary"),
    type: text(row, "document_type"),
    language: text(row, "language") || "pt-BR",
    versionId: text(row, "version_id"),
    version: numeric(row, "version"),
    effectiveFrom: text(row, "effective_from"),
    ...(text(row, "effective_until") ? { effectiveUntil: text(row, "effective_until") } : {}),
    publishedAt: text(row, "published_at"),
    sections: records(snapshot.sections).map((section) => ({
      number: text(section, "section_number"),
      title: text(section, "title"),
      content: text(section, "content")
    })),
    references: records(snapshot.references).flatMap((reference) => {
      const officialUrl = text(reference, "official_url");
      return officialUrl
        ? [
            {
              name: text(reference, "name"),
              ...(text(reference, "related_article")
                ? { relatedArticle: text(reference, "related_article") }
                : {}),
              officialUrl,
              consultedOn: text(reference, "consulted_on")
            }
          ]
        : [];
    }),
    company
  };
}

export async function getPublicLegalDocuments() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const result = await supabase.from("published_legal_documents").select("*").order("public_title");
  if (result.error) return [];
  return records(result.data).flatMap((row) => {
    const document = mapDocument(row);
    return document ? [document] : [];
  });
}

export async function getPublicLegalDocument(slug: string) {
  const documents = await getPublicLegalDocuments();
  return documents.find((document) => document.slug === slug) ?? null;
}
