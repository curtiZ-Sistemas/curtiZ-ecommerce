import { unzipSync, strFromU8 } from "fflate";
import {
  legalContentKey,
  legalPlainText,
  legalSectionsFromText,
  recognizeLegalPolicy,
  safeLegalLink,
  normalizeLegalName,
  type LegalSection,
  type LegalSlug
} from "@curtiz/domain";

export const legalImportLimits = {
  files: 40,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 24 * 1024 * 1024,
  entries: 100,
  expandedBytes: 40 * 1024 * 1024,
  entryBytes: 4 * 1024 * 1024
};
export type LegalImportCandidate = {
  name: string;
  slug?: LegalSlug;
  sections: LegalSection[];
  key: string;
  warnings: string[];
  quality: number;
};
type Input = { name: string; bytes: Uint8Array };
const wordNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const supported = /\.(docx|txt|html?|md|json)$/iu;

/** Inspect the central directory BEFORE inflation, including DOCX containers. */
export function boundedLegalUnzip(bytes: Uint8Array, keep?: (name: string) => boolean) {
  if (bytes.length > legalImportLimits.fileBytes) throw new Error("Arquivo maior que 8 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50)
    end--;
  if (end < 0 || end < bytes.length - 65557) throw new Error("ZIP inválido.");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error("ZIP dividido não é aceito.");
  const count = view.getUint16(end + 10, true);
  if (!count || count > legalImportLimits.entries || view.getUint16(end + 8, true) !== count)
    throw new Error("ZIP excede o limite de 100 entradas.");
  let offset = view.getUint32(end + 16, true),
    total = 0;
  const sizes = new Map<string, number>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("Diretório ZIP inválido.");
    const size = view.getUint32(offset + 24, true),
      compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true),
      extra = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength + extra + comment > end)
      throw new Error("Diretório ZIP truncado.");
    const name = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    total += size;
    if (
      view.getUint16(offset + 8, true) & 1 ||
      view.getUint16(offset + 34, true) ||
      size === 0xffffffff ||
      compressed === 0xffffffff ||
      size > legalImportLimits.entryBytes ||
      total > legalImportLimits.expandedBytes ||
      size > Math.max(1024 * 1024, compressed * 200)
    )
      throw new Error("ZIP protegido ou com descompactação excessiva.");
    if (
      /^[/]|^[a-z]:|\\/iu.test(name) ||
      name.includes(String.fromCharCode(0)) ||
      name.split("/").includes("..") ||
      sizes.has(name)
    )
      throw new Error("ZIP com caminhos perigosos ou duplicados.");
    sizes.set(name, size);
    offset += 46 + nameLength + extra + comment;
  }
  const files = unzipSync(bytes, { filter: (entry) => !keep || keep(entry.name) });
  if (Object.entries(files).some(([name, data]) => sizes.get(name) !== data.length))
    throw new Error("Tamanho descompactado divergente.");
  return files;
}
function parseXML(source: string) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    throw new Error("DOCX com entidades externas não é aceito.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("DOCX ilegível.");
  return doc;
}
const elements = (node: Element | Document, local: string) =>
  Array.from(node.getElementsByTagNameNS(wordNS, local));
const wordValue = (node: Element | undefined) => node?.getAttributeNS(wordNS, "val") ?? "";
const escapeText = (value: string) => value.replace(/[\\*`]/gu, "\\$&");

export function docxLegalText(bytes: Uint8Array) {
  const files = boundedLegalUnzip(bytes, (name) =>
    ["word/document.xml", "word/_rels/document.xml.rels", "word/numbering.xml"].includes(name)
  );
  if (!files["word/document.xml"]) throw new Error("Arquivo não contém um documento Word.");
  const document = parseXML(strFromU8(files["word/document.xml"]));
  if (elements(document, "altChunk").length || elements(document, "object").length)
    throw new Error("DOCX com conteúdo incorporado não é aceito.");
  const links = new Map<string, string>();
  if (files["word/_rels/document.xml.rels"]) {
    const relationships = parseXML(strFromU8(files["word/_rels/document.xml.rels"]));
    for (const rel of Array.from(relationships.getElementsByTagName("Relationship"))) {
      const href = safeLegalLink(rel.getAttribute("Target") ?? "");
      if (href && rel.getAttribute("Type")?.endsWith("/hyperlink"))
        links.set(rel.getAttribute("Id") ?? "", href);
    }
  }
  const counters = new Map<string, number>();
  const lines = elements(document, "body").flatMap((body) =>
    elements(body, "p").map((paragraph) => {
      const runs = elements(paragraph, "r")
        .map((run) => {
          let text = Array.from(run.childNodes)
            .map((child) =>
              child.nodeType === 1
                ? (child as Element).localName === "t"
                  ? escapeText(child.textContent ?? "")
                  : ["br", "cr"].includes((child as Element).localName)
                    ? "\n"
                    : (child as Element).localName === "tab"
                      ? "\t"
                      : ""
                : ""
            )
            .join("");
          const bold = elements(run, "b")[0],
            italic = elements(run, "i")[0];
          if (text.trim() && bold && !["0", "false", "off"].includes(wordValue(bold)))
            text = `**${text}**`;
          if (text.trim() && italic && !["0", "false", "off"].includes(wordValue(italic)))
            text = `*${text}*`;
          const parent = run.parentElement;
          const href =
            parent?.localName === "hyperlink"
              ? links.get(
                  parent.getAttributeNS(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
                    "id"
                  ) ?? ""
                )
              : undefined;
          return href ? `[${text}](${href})` : text;
        })
        .join("");
      const style = wordValue(elements(paragraph, "pStyle")[0]);
      if (/^(Heading|T[ií]tulo)[1-6]$/iu.test(style) || style === "Title")
        return `${style === "Title" ? "#" : "##"} ${runs}`;
      const num = wordValue(elements(paragraph, "numId")[0]);
      if (num && num !== "0") {
        const numbering = files["word/numbering.xml"]
          ? parseXML(strFromU8(files["word/numbering.xml"]))
          : null;
        const numNode =
          numbering &&
          elements(numbering, "num").find((item) => item.getAttributeNS(wordNS, "numId") === num);
        const abstractId = numNode ? wordValue(elements(numNode, "abstractNumId")[0]) : "";
        const definition =
          numbering &&
          elements(numbering, "abstractNum").find(
            (item) => item.getAttributeNS(wordNS, "abstractNumId") === abstractId
          );
        const level =
          definition &&
          elements(definition, "lvl").find(
            (item) =>
              item.getAttributeNS(wordNS, "ilvl") ===
              (wordValue(elements(paragraph, "ilvl")[0]) || "0")
          );
        const count =
          (counters.get(num) ??
            (Number(level && wordValue(elements(level, "start")[0])) || 1) - 1) + 1;
        counters.set(num, count);
        return `${level && wordValue(elements(level, "numFmt")[0]) === "bullet" ? "-" : `${count}.`} ${runs}`;
      }
      return runs;
    })
  );
  return lines.filter(Boolean).join("\n\n");
}
export function htmlLegalText(source: string) {
  // DOMParser é inerte para scripts, mas recursos remotos também precisam ser
  // removidos antes de criar o documento, evitando requisições de rastreamento.
  const inertSource = source.replace(
    /<\/?(?:img|image|source|video|audio|iframe|object|embed|link|base|meta|input|svg|math)\b[^>]*>/giu,
    ""
  );
  const doc = new DOMParser().parseFromString(inertSource, "text/html");
  doc
    .querySelectorAll(
      "script,style,iframe,object,embed,svg,math,template,noscript,[hidden],.print-header,.print-footer"
    )
    .forEach((node) => node.remove());
  const inline = (node: Node): string => {
    if (node.nodeType === 3) return escapeText(node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const text = Array.from(element.childNodes).map(inline).join("");
    if (["TD", "TH"].includes(element.tagName)) return `${text}\t`;
    if (["STRONG", "B"].includes(element.tagName)) return text.trim() ? `**${text}**` : text;
    if (["EM", "I"].includes(element.tagName)) return text.trim() ? `*${text}*` : text;
    if (element.tagName === "BR") return "\n";
    if (element.tagName === "A") {
      const href = safeLegalLink(element.getAttribute("href") ?? "");
      return href ? `[${text}](${href})` : text;
    }
    return text;
  };
  const walk = (element: Element): string => {
    if (/^H[1-6]$/u.test(element.tagName))
      return `${element.tagName === "H1" ? "#" : "##"} ${inline(element)}\n\n`;
    if (element.tagName === "LI")
      return `${element.parentElement?.tagName === "OL" ? `${Number(element.parentElement.getAttribute("start") ?? "1") + Array.from(element.parentElement.children).indexOf(element)}.` : "-"} ${inline(element)}\n`;
    if (["P", "TR", "BLOCKQUOTE"].includes(element.tagName)) return `${inline(element)}\n\n`;
    return Array.from(element.childNodes)
      .map((child) => (child.nodeType === 1 ? walk(child as Element) : inline(child)))
      .join("");
  };
  return walk(doc.body).trim();
}
function manifestAssociations(
  value: unknown,
  mappings: Map<string, LegalSlug>,
  inherited?: LegalSlug
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child) => manifestAssociations(child, mappings, inherited));
    return;
  }
  const record = value as Record<string, unknown>;
  const destination = [
    record.slug,
    record.document_type,
    record.tipo,
    record.titulo,
    record.title,
    record.titulo_publico,
    record.destino,
    record.url,
    record.rota
  ]
    .flatMap((field) => (typeof field === "string" ? [recognizeLegalPolicy(field)] : []))
    .filter(Boolean);
  const slug = new Set(destination).size === 1 ? destination[0] : inherited;
  for (const [key, child] of Object.entries(record)) {
    const keySlug = recognizeLegalPolicy(key) ?? slug;
    if (typeof child === "string" && supported.test(child) && keySlug) {
      const name = child.split(/[\\/]/u).pop()!;
      if (mappings.has(name) && mappings.get(name) !== keySlug)
        throw new Error(`Manifesto com destinos conflitantes: ${name}.`);
      mappings.set(name, keySlug);
    } else manifestAssociations(child, mappings, keySlug);
  }
}
export async function importLegalFiles(files: File[], forcedSlug?: LegalSlug) {
  if (
    !files.length ||
    files.length > legalImportLimits.files ||
    files.reduce((sum, file) => sum + file.size, 0) > legalImportLimits.totalBytes
  )
    throw new Error("Selecione até 40 arquivos, total máximo de 24 MB.");
  const inputs: Input[] = [],
    ignored: string[] = [],
    errors: string[] = [];
  let expanded = 0;
  for (const file of files) {
    try {
      if (!file.size || file.size > legalImportLimits.fileBytes)
        throw new Error("Arquivo vazio ou maior que 8 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/iu.test(file.name)) {
        const entries = boundedLegalUnzip(bytes);
        for (const [name, data] of Object.entries(entries)) {
          expanded += data.length;
          if (expanded > legalImportLimits.expandedBytes)
            throw new Error("Pacote excede 40 MB descompactados.");
          if (supported.test(name)) inputs.push({ name, bytes: data });
          else if (!name.endsWith("/")) ignored.push(name);
        }
      } else inputs.push({ name: file.name, bytes });
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : "Arquivo ilegível."}`);
    }
  }
  if (inputs.length > legalImportLimits.files)
    throw new Error("O pacote contém mais de 40 documentos.");
  const mappings = new Map<string, LegalSlug>();
  for (const input of inputs.filter((item) => /\.json$/iu.test(item.name))) {
    try {
      if (input.bytes.length > 256 * 1024)
        throw new Error("O manifesto excede o limite de 256 KB.");
      if (!/mapa[ _-]de[ _-]publica[cç][aã]o\.json$/iu.test(input.name.split("/").pop()!))
        throw new Error("Use Mapa_de_Publicacao.json para o manifesto.");
      manifestAssociations(JSON.parse(strFromU8(input.bytes)), mappings);
      ignored.push(input.name);
    } catch (error) {
      throw new Error(
        `${input.name}: ${error instanceof Error ? error.message : "Manifesto inválido."}`
      );
    }
  }
  const candidates: LegalImportCandidate[] = [];
  for (const input of inputs.filter((item) => !/\.json$/iu.test(item.name))) {
    try {
      if (normalizeLegalName(input.name).includes("guia de preenchimento e publicacao")) {
        ignored.push(input.name);
        continue;
      }
      const extension = input.name.split(".").pop()?.toLowerCase();
      if (!supported.test(input.name)) throw new Error("Formato não aceito.");
      const content =
        extension === "docx"
          ? docxLegalText(input.bytes)
          : /^html?$/u.test(extension ?? "")
            ? htmlLegalText(strFromU8(input.bytes))
            : new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      const title = legalPlainText(content.split("\n").find((line) => line.trim()) ?? "");
      if (normalizeLegalName(title).includes("guia de preenchimento e publicacao")) {
        ignored.push(input.name);
        continue;
      }
      const filenameSlug = recognizeLegalPolicy(input.name.replace(/\.[^.]+$/u, "")),
        titleSlug = recognizeLegalPolicy(title),
        manifestSlug = mappings.get(input.name.split("/").pop()!);
      const recognized = [
        ...new Set(
          [manifestSlug, filenameSlug, titleSlug].filter((item): item is LegalSlug => Boolean(item))
        )
      ];
      const slug = forcedSlug ?? (recognized.length === 1 ? recognized[0] : undefined);
      const warnings =
        recognized.length > 1
          ? ["Nome, título ou manifesto indicam políticas diferentes. Escolha o destino."]
          : [];
      if (forcedSlug && recognized.some((item) => item !== forcedSlug))
        warnings.push(
          "O conteúdo parece pertencer a outra política. Confira antes de salvar neste destino."
        );
      const sections = legalSectionsFromText(content, extension === "txt" ? "plain" : "markdown");
      if (
        !sections.length ||
        sections.reduce((sum, section) => sum + section.content.length, 0) < 30
      )
        throw new Error("Não foi possível extrair conteúdo legível suficiente.");
      if (sections.length > 80 || sections.some((section) => section.content.length > 30000))
        throw new Error("Documento excede o limite de conteúdo.");
      candidates.push({
        name: input.name,
        slug,
        sections,
        key: legalContentKey(sections),
        warnings,
        quality: extension === "docx" ? 3 : /^html?$/u.test(extension ?? "") ? 2 : 1
      });
    } catch (error) {
      errors.push(`${input.name}: ${error instanceof Error ? error.message : "Arquivo ilegível."}`);
    }
  }
  const deduplicated: LegalImportCandidate[] = [];
  for (const candidate of candidates) {
    const same = deduplicated.findIndex(
      (item) => item.slug === candidate.slug && item.key === candidate.key
    );
    if (same < 0) deduplicated.push(candidate);
    else {
      const previous = deduplicated[same]!;
      deduplicated[same] = {
        ...(previous.quality >= candidate.quality ? previous : candidate),
        name: `${previous.name}, ${candidate.name}`
      };
    }
  }
  return { candidates: deduplicated, ignored, errors };
}
