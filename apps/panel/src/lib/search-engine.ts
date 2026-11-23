// Motor de busca local da barra "Buscar" do painel.
// Sem dependências: normaliza acentos e caixa, tokeniza, tolera pequenos erros de digitação
// e ranqueia título exato > prefixo > sinônimo > descrição.

export type Searchable = {
  id: string;
  title: string;
  description?: string;
  keywords?: readonly string[];
  area?: string;
};

export type Ranked<T> = { item: T; score: number };
export type HighlightSegment = { text: string; match: boolean };

const STOPWORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "no", "na", "nos", "nas",
  "em", "para", "pra", "por", "com", "sem", "e", "ou", "ao", "aos", "que", "como", "quero", "preciso", "onde",
  "meu", "minha", "meus", "minhas", "ver", "abrir"
]);

const stripMarks = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");

/** Minúsculas, sem acentos, só letras/números separados por espaço simples. */
export function normalizeText(value: string): string {
  return stripMarks(value)
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Singular grosseiro: "solicitações" -> "solicitacao", "pedidos" -> "pedido". */
export function stem(token: string): string {
  if (token.length > 4 && (token.endsWith("oes") || token.endsWith("aes"))) return `${token.slice(0, -3)}ao`;
  if (token.length > 3 && token.endsWith("ns")) return `${token.slice(0, -2)}m`;
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Tokens normalizados e "stemmed"; descarta palavras vazias ("de", "para"...). */
export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const all = normalized.split(" ");
  const meaningful = all.filter((token) => !STOPWORDS.has(token));
  return (meaningful.length ? meaningful : all).map(stem);
}

/** Distância de edição (Damerau-OSA) com corte: devolve max + 1 quando passa do limite. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(matrix[i - 1]![j]! + 1, matrix[i]![j - 1]! + 1, matrix[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, matrix[i - 2]![j - 2]! + 1);
      }
      matrix[i]![j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
  }
  return matrix[rows - 1]![cols - 1]!;
}

const fuzzyLimit = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

function sharesRoot(a: string, b: string) {
  if (a.length < 6 || b.length < 6) return false;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 6;
}

type TokenSource = "title" | "keyword" | "area" | "description";
const SCORES: Record<TokenSource, { exact: number; prefix: number; root: number; fuzzy: number }> = {
  title: { exact: 100, prefix: 80, root: 55, fuzzy: 50 },
  keyword: { exact: 70, prefix: 55, root: 40, fuzzy: 36 },
  area: { exact: 40, prefix: 30, root: 20, fuzzy: 16 },
  description: { exact: 30, prefix: 20, root: 14, fuzzy: 12 }
};

function scoreToken(query: string, candidates: readonly string[], source: TokenSource) {
  const table = SCORES[source];
  const limit = fuzzyLimit(query.length);
  let best = 0;
  for (const candidate of candidates) {
    if (candidate === query) return table.exact;
    if (query.length >= 2 && candidate.startsWith(query)) best = Math.max(best, table.prefix);
    else if (best < table.root && sharesRoot(query, candidate)) best = Math.max(best, table.root);
    else if (best < table.fuzzy && limit > 0 && editDistance(query, candidate, limit) <= limit) {
      best = Math.max(best, table.fuzzy);
    }
  }
  return best;
}

type Indexed = {
  title: string;
  titleTokens: string[];
  keywordPhrases: string[];
  keywordPhraseTokens: string[][];
  keywordTokens: string[];
  areaTokens: string[];
  descriptionNorm: string;
  descriptionTokens: string[];
};

const cache = new WeakMap<object, Indexed>();

function indexOf(item: Searchable): Indexed {
  const cached = cache.get(item);
  if (cached) return cached;
  const keywordPhrases = (item.keywords ?? []).map(normalizeText).filter(Boolean);
  const keywordPhraseTokens = keywordPhrases.map(tokenize);
  const next: Indexed = {
    title: normalizeText(item.title),
    titleTokens: tokenize(item.title),
    keywordPhrases,
    keywordPhraseTokens,
    keywordTokens: Array.from(new Set(keywordPhraseTokens.flat())),
    areaTokens: tokenize(item.area ?? ""),
    descriptionNorm: normalizeText(item.description ?? ""),
    descriptionTokens: tokenize(item.description ?? "")
  };
  cache.set(item, next);
  return next;
}

/** Pontuação de um item para a consulta; 0 significa que não casa. */
export function scoreItem(query: string, item: Searchable): number {
  const fullQuery = normalizeText(query);
  const tokens = tokenize(query);
  if (!fullQuery || !tokens.length) return 0;
  const index = indexOf(item);

  let total = 0;
  let inTitle = 0;
  for (const token of tokens) {
    const titleScore = scoreToken(token, index.titleTokens, "title");
    const best = Math.max(
      titleScore,
      scoreToken(token, index.keywordTokens, "keyword"),
      scoreToken(token, index.areaTokens, "area"),
      scoreToken(token, index.descriptionTokens, "description")
    );
    if (best === 0) return 0; // todos os termos precisam casar em algum lugar
    if (titleScore > 0) inTitle += 1;
    total += best;
  }

  if (index.title === fullQuery) total += 400;
  else if (index.title.startsWith(fullQuery)) total += 150;
  else if (index.title.includes(fullQuery)) total += 80;
  if (inTitle === tokens.length) total += 60;

  let phraseBonus = 0;
  index.keywordPhrases.forEach((phrase, position) => {
    if (phrase === fullQuery) phraseBonus = Math.max(phraseBonus, 120);
    else if (phrase.startsWith(fullQuery)) phraseBonus = Math.max(phraseBonus, 70);
    else if (fullQuery.length >= 3 && phrase.includes(fullQuery)) phraseBonus = Math.max(phraseBonus, 40);
    const phraseTokens = index.keywordPhraseTokens[position] ?? [];
    if (tokens.length > 1 && tokens.every((token) => phraseTokens.some((candidate) => candidate === token || candidate.startsWith(token)))) {
      phraseBonus = Math.max(phraseBonus, 60);
    }
  });
  total += phraseBonus;

  if (fullQuery.length >= 3 && index.descriptionNorm.includes(fullQuery)) total += 25;
  return total;
}

/** Ordena por relevância (estável: empates mantêm a ordem do registro). */
export function rankSearch<T extends Searchable>(query: string, items: readonly T[], limit = 8): Ranked<T>[] {
  return items
    .map((item, position) => ({ item, score: scoreItem(query, item), position }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}

/** Divide o texto em trechos destacando os termos buscados, ignorando acentos e caixa. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = normalizeText(query).split(" ").filter((term) => term.length >= 2 && !STOPWORDS.has(term));
  if (!terms.length || !text) return [{ text, match: false }];

  // Mapa de cada caractere original para o texto normalizado (mesmo comprimento, 1:1).
  const folded = Array.from(text).map((char) => {
    const base = stripMarks(char).toLocaleLowerCase("pt-BR");
    return base.length === 1 ? base : char.toLocaleLowerCase("pt-BR").slice(0, 1);
  });
  const chars = Array.from(text);
  const flags = new Array<boolean>(chars.length).fill(false);
  const haystack = folded.join("");
  const stems = new Set(terms.map(stem));
  for (const match of haystack.matchAll(/[a-z0-9]+/g)) {
    const word = match[0];
    const at = match.index ?? 0;
    const matchedTerm = terms.find((term) => word.startsWith(term));
    const length = matchedTerm ? matchedTerm.length : stems.has(stem(word)) ? word.length : 0;
    for (let i = at; i < at + length; i += 1) flags[i] = true;
  }

  const segments: HighlightSegment[] = [];
  chars.forEach((char, i) => {
    const last = segments.at(-1);
    if (last && last.match === flags[i]) last.text += char;
    else segments.push({ text: char, match: flags[i]! });
  });
  return segments;
}
