import { legalInlineTokens } from "./legal-inline";
export { safeLegalLink } from "./legal-inline";
export const legalPolicies = [
  {
    slug: "termos-de-uso",
    type: "terms",
    title: "Termos de Uso e Condições de Compra",
    aliases: ["termos de uso", "condicoes de compra"]
  },
  {
    slug: "aviso-de-privacidade",
    type: "privacy",
    title: "Política de Privacidade",
    aliases: ["privacidade"]
  },
  {
    slug: "politica-de-cookies",
    type: "cookies",
    title: "Política de Cookies",
    aliases: ["cookies"]
  },
  {
    slug: "trocas-e-devolucoes",
    type: "returns",
    title: "Política de Trocas, Devoluções e Reembolsos",
    aliases: ["trocas", "devolucoes", "reembolsos"]
  },
  {
    slug: "entrega",
    type: "shipping",
    title: "Política de Entrega e Frete",
    aliases: ["entrega", "frete"]
  },
  { slug: "pagamento", type: "payment", title: "Formas de Pagamento", aliases: ["pagamento"] },
  { slug: "garantia", type: "warranty", title: "Política de Garantia", aliases: ["garantia"] },
  {
    slug: "termos-representante",
    type: "representative_terms",
    title: "Termos dos Representantes",
    aliases: ["representantes", "termos representante", "termos do representante"]
  }
] as const;
export type LegalSlug = (typeof legalPolicies)[number]["slug"];
export type LegalSection = {
  section_number: string;
  title: string;
  content: string;
  content_format: "plain" | "markdown";
  sort_order: number;
};
export const normalizeLegalName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
export function recognizeLegalPolicy(value: string): LegalSlug | undefined {
  const typedPolicy = legalPolicies.find((policy) => policy.type === value);
  if (typedPolicy) return typedPolicy.slug;
  const normalized = ` ${normalizeLegalName(value)} `;
  const matches = legalPolicies.filter((policy) =>
    [policy.slug, policy.title, ...policy.aliases].some((alias) =>
      normalized.includes(` ${normalizeLegalName(alias)} `)
    )
  );
  return matches.length === 1 ? matches[0]?.slug : undefined;
}
export function legalPlainText(value: string) {
  return legalInlineTokens(value)
    .map((token) => token.text)
    .join("")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^[-*]\s+/gmu, "");
}
export function legalContentKey(
  sections: (Pick<LegalSection, "title" | "content" | "section_number"> & {
    content_format?: "plain" | "markdown";
  })[]
) {
  return sections
    .map(
      (section) =>
        `${section.section_number === "0" ? "" : section.section_number} ${section.title} ${section.content_format === "plain" ? section.content : legalPlainText(section.content)}`
    )
    .join(" ")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}
export function legalPlaceholders(value: string) {
  return [...new Set(value.match(/\[[A-ZÀ-Ý][A-ZÀ-Ý0-9_ /-]{1,120}\]/gu) ?? [])].sort();
}
export const legalCompanyMarkers: Record<string, string> = {
  "[RAZAO_SOCIAL]": "legal_name",
  "[CNPJ]": "tax_id",
  "[ENDERECO_EMPRESARIAL]": "address",
  "[EMAIL_ATENDIMENTO]": "email",
  "[CANAL_PRIVACIDADE]": "privacy_channel",
  "[CONTATO_PRIVACIDADE]": "data_protection_contact"
};
export function legalCompanyReplacements(company: Record<string, unknown> | null) {
  if (company?.completeness_status !== "complete") return {};
  return Object.fromEntries(
    Object.entries(legalCompanyMarkers).flatMap(([marker, field]) => {
      const value = company[field];
      return typeof value === "string" && value.trim() && !legalPlaceholders(value).length
        ? [[marker, value.trim()]]
        : [];
    })
  );
}
export function legalCompanyProblems(company: Record<string, unknown> | null) {
  const field = (key: string) => (typeof company?.[key] === "string" ? company[key].trim() : "");
  const problems: string[] = [];
  if (company?.completeness_status !== "complete")
    problems.push("Dados empresariais precisam ser conferidos");
  if (field("legal_name").length < 3) problems.push("Razão social");
  const cnpj = field("tax_id").replace(/\D/gu, "");
  if (!/^\d{14}$/u.test(cnpj) || /^(\d)\1{13}$/u.test(cnpj)) problems.push("CNPJ");
  if (field("address").length < 10) problems.push("Endereço empresarial");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(field("email"))) problems.push("E-mail de atendimento");
  if (field("privacy_channel").length < 3) problems.push("Canal de privacidade");
  return [
    ...new Set([
      ...problems,
      ...Object.values(company ?? {}).flatMap((item) =>
        typeof item === "string" ? legalPlaceholders(item) : []
      )
    ])
  ];
}
export function replaceLegalMarkers(
  sections: LegalSection[],
  replacements: Record<string, string>
) {
  const substitute = (value: string) =>
    value.replace(
      /\[[A-ZÀ-Ý][A-ZÀ-Ý0-9_ /-]{1,120}\]/gu,
      (marker) => replacements[marker] ?? marker
    );
  return sections.map((section) => ({
    ...section,
    title: substitute(section.title),
    content: substitute(section.content)
  }));
}
/** Only numbered standalone headings become sections; all other lines are retained. */
export function legalSectionsFromText(
  source: string,
  format: "plain" | "markdown" = "plain"
): LegalSection[] {
  const sections: LegalSection[] = [];
  let current: LegalSection = {
    section_number: "0",
    title: "Apresentação",
    content: "",
    content_format: format,
    sort_order: 0
  };
  const used = new Set(["0"]);
  for (const line of source.replace(/\r\n?/gu, "\n").split("\n")) {
    const plain = legalPlainText(line).trim();
    const heading = /^(\d+(?:\.\d+)*)[.)]?\s+([^\n]{2,180})$/u.exec(plain);
    const isHeading =
      heading &&
      !used.has(heading[1]!) &&
      (/^#{1,6}\s/u.test(line) ||
        (line === plain && !/^\d+[.)]\s/u.test(plain) && !/[.!?;:]$/u.test(plain)));
    if (isHeading || /^Refer[eê]ncias(?: normativas| bibliogr[aá]ficas)?$/iu.test(plain)) {
      if (current.content.trim()) sections.push({ ...current, content: current.content.trim() });
      const sectionNumber = isHeading
        ? heading[1]!
        : String(
            Math.max(
              0,
              ...[...used].map((number) => Number(number.split(".")[0])).filter(Number.isFinite)
            ) + 1
          );
      used.add(sectionNumber);
      current = {
        section_number: sectionNumber,
        title: isHeading ? heading[2]! : plain,
        content: "",
        content_format: format,
        sort_order: sections.length
      };
    } else current.content += `${line}\n`;
  }
  if (current.content.trim()) sections.push({ ...current, content: current.content.trim() });
  return sections;
}
export function legalSectionsToText(sections: LegalSection[]) {
  return sections
    .map(
      (section) =>
        `${section.section_number === "0" ? "" : `## ${section.section_number} ${section.title}\n\n`}${section.content_format === "plain" ? section.content.replace(/[\\*`]/gu, "\\$&") : section.content}`
    )
    .join("\n\n");
}
