/** Presentation only. Never use this value for metadata, slugs, checkout or storage. */
export function productCardName(name: string): string {
  const clean = name.trim().replace(/^curti\s*z\s+/iu, "");
  if (clean.length <= 38) return clean;
  const words = clean
    .replace(/\balto padrão\b/giu, "")
    .split(/\s+/u)
    .filter((word) => !/^(chinelos?|sandálias?|femininos?|femininas?|masculinos?|masculinas?|confortável|luxo|oferta)$/iu.test(word));
  const unique = words.filter((word, index) => words.findIndex((candidate) => candidate.toLocaleLowerCase("pt-BR") === word.toLocaleLowerCase("pt-BR")) === index);
  return unique.join(" ").trim() || clean;
}
