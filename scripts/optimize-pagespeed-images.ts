import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type ImagePipeline = {
  rotate(): ImagePipeline;
  resize(options: { width: number; withoutEnlargement?: boolean }): ImagePipeline;
  webp(options: { quality: number }): ImagePipeline;
  avif(options: { quality: number; effort: number }): ImagePipeline;
  toFile(destination: string): Promise<unknown>;
};
const taskRequire = createRequire(import.meta.url);
const sharp = taskRequire(taskRequire.resolve("sharp", {
  paths: [taskRequire.resolve("next/package.json", { paths: ["./apps/store"] })]
})) as { (source: string | Buffer, options?: { limitInputPixels: number }): ImagePipeline; concurrency(value: number): void };

// Accept a saved Lighthouse JSON report. Only public catalog image URLs are downloaded.
async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Informe o caminho do relatório Lighthouse JSON.");
  const report: unknown = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
  const items = record(record(record(report).audits)["image-delivery-insight"]).details;
  const entries = record(items).items;
  if (!Array.isArray(entries)) throw new Error("Relatório sem auditoria de imagens.");
  const directory = "apps/store/public/images/optimized";
  await fs.mkdir(directory, { recursive: true });
  const manifest: Record<string, string> = {};
  sharp.concurrency(1);
  for (const item of entries as unknown[]) {
    const source = record(item).url;
    if (typeof source !== "string") continue;
    const url = new URL(source);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !url.pathname.startsWith("/storage/v1/object/public/catalog-public/products/")) continue;
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Falha no download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error("Imagem excede o limite.");
    const name = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    for (const width of [360, 540, 720]) await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(directory, `${name}.${width}.webp`));
    manifest[source] = `/images/optimized/${name}`;
  }
  await fs.writeFile("apps/store/src/lib/optimized-catalog-images.json", JSON.stringify(manifest, null, 2) + "\n");
  for (const width of [430, 640]) await sharp("apps/store/public/images/hero-curtiz-mobile.avif").resize({ width }).avif({ quality: 48, effort: 3 }).toFile(`${directory}/hero-mobile.${width}.avif`);
  await sharp("apps/store/public/images/logo-curtiz.webp").resize({ width: 280 }).webp({ quality: 82 }).toFile(`${directory}/logo.webp`);
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Falha ao otimizar imagens."); process.exitCode = 1; });
