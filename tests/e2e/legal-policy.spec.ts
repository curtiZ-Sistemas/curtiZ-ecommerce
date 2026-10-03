import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { legalPolicies } from "../../packages/domain/src/legal-policies";
import type * as LegalImport from "../../apps/panel/src/lib/legal-import";
import type * as LegalDomain from "../../packages/domain/src/legal-policies";
const fixtureNames = [
  "00-guia-de-preenchimento-e-publicacao",
  "01-termos-de-uso",
  "02-politica-de-privacidade",
  "03-politica-de-cookies",
  "04-trocas-devolucoes-reembolsos",
  "05-entrega-e-frete",
  "06-formas-de-pagamento",
  "07-politica-de-garantia",
  "08-termos-dos-representantes"
];
const fixtureDirectory = process.env.LEGAL_DOCUMENT_FIXTURES;
const taskRequire = createRequire(resolve("package.json"));
const build = createRequire(taskRequire.resolve("tsx"))("esbuild") as {
  buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
};
const importerScript = build.buildSync({
  stdin: {
    contents:
      'import * as importer from "./apps/panel/src/lib/legal-import"; import * as domain from "./packages/domain/src/legal-policies"; globalThis.legalTest = { ...importer, ...domain };',
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2022"
}).outputFiles[0]!.text;

test("anexos reais: oito destinos, equivalência DOCX/TXT/HTML, ZIP e formatação", async ({
  page
}) => {
  test.skip(
    !fixtureDirectory,
    "Defina LEGAL_DOCUMENT_FIXTURES com o diretório dos nove DOCX anexados."
  );
  const inputs = fixtureNames.map((name) => ({
    name: `${name}.docx`,
    data: Array.from(readFileSync(resolve(fixtureDirectory!, `${name}.docx`)))
  }));
  await page.setContent("<!doctype html><title>Validação isolada dos parsers</title>");
  await page.addScriptTag({ content: importerScript });
  const result = await page.evaluate(async (inputs) => {
    const api = (
      globalThis as unknown as {
        legalTest: typeof LegalImport & typeof LegalDomain;
      }
    ).legalTest;
    const files = inputs.map((input) => new File([new Uint8Array(input.data)], input.name));
    const single = await api.importLegalFiles([files[1]!]);
    const multiple = await api.importLegalFiles(files);
    const source = files.slice(1).map((file, index) => ({
      name: file.name,
      content: api.docxLegalText(new Uint8Array(inputs[index + 1]!.data))
    }));
    // XML original é conferido independentemente da divisão em seções.
    const exact = inputs.slice(1).flatMap((input, index) => {
      const xml = new TextDecoder().decode(
        api.boundedLegalUnzip(new Uint8Array(input.data))["word/document.xml"]
      );
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const original = Array.from(
        doc.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "p"
        )
      )
        .map((paragraph) =>
          Array.from(
            paragraph.getElementsByTagNameNS(
              "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
              "t"
            )
          )
            .map((run) => run.textContent ?? "")
            .join("")
        )
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      const extracted = api.legalPlainText(source[index]!.content).replace(/\s+/gu, " ").trim();
      if (extracted === original) return [];
      let position = 0;
      while (
        position < Math.min(extracted.length, original.length) &&
        extracted[position] === original[position]
      )
        position++;
      return [
        {
          name: input.name,
          position,
          original: original.slice(Math.max(0, position - 50), position + 100),
          extracted: extracted.slice(Math.max(0, position - 50), position + 100)
        }
      ];
    });
    const escape = (text: string) =>
      text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const variants = source.flatMap((item) => [
      new File([api.legalPlainText(item.content)], item.name.replace(/docx$/u, "txt")),
      new File(
        [
          item.content
            .split(/\n\s*\n/u)
            .map((line) =>
              /^## /u.test(line)
                ? `<h2>${escape(api.legalPlainText(line))}</h2>`
                : /^# /u.test(line)
                  ? `<h1>${escape(api.legalPlainText(line))}</h1>`
                  : `<p>${escape(api.legalPlainText(line))}</p>`
            )
            .join("")
        ],
        item.name.replace(/docx$/u, "html")
      )
    ]);
    const equivalent = await api.importLegalFiles([...files, ...variants]);
    const zipVariants = await Promise.all(
      variants.map(async (file) => ({
        name: file.name,
        data: Array.from(new Uint8Array(await file.arrayBuffer()))
      }))
    );
    return {
      single,
      multiple,
      equivalent,
      exact,
      zipVariants,
      bold: multiple.candidates.filter((candidate) =>
        candidate.sections.some((section) => section.content.includes("**"))
      ).length
    };
  }, inputs);
  expect(result.single.candidates[0]?.slug).toBe("termos-de-uso");
  expect(result.multiple.errors).toEqual([]);
  expect(result.multiple.candidates.map((item) => item.slug).sort()).toEqual(
    legalPolicies.map((policy) => policy.slug).sort()
  );
  expect(result.multiple.ignored).toContain("00-guia-de-preenchimento-e-publicacao.docx");
  expect(result.exact).toEqual([]);
  expect(result.bold).toBe(8);
  expect(result.equivalent.errors).toEqual([]);
  expect(result.equivalent.candidates).toHaveLength(8);
  const panelRequire = createRequire(resolve("apps/panel/package.json"));
  const compression = panelRequire("fflate") as {
    zipSync(files: Record<string, Uint8Array>): Uint8Array;
  };
  const zip = compression.zipSync(
    Object.fromEntries(
      [
        ...inputs,
        ...result.zipVariants,
        {
          name: "Mapa_de_Publicacao.json",
          data: Array.from(
            Buffer.from(
              JSON.stringify({
                documentos: legalPolicies.map((policy, index) => ({
                  slug: policy.slug,
                  arquivos: { docx: inputs[index + 1]!.name },
                  vigencia: "A partir da publicação",
                  referencias: ["Referência bibliográfica preservada no documento completo"]
                }))
              })
            )
          )
        }
      ].map((input) => [input.name, new Uint8Array(input.data)])
    )
  );
  const packageResult = await page.evaluate(async (bytes) => {
    const api = (globalThis as unknown as { legalTest: typeof LegalImport }).legalTest;
    return api.importLegalFiles([new File([new Uint8Array(bytes)], "politicas.zip")]);
  }, Array.from(zip));
  expect(packageResult.errors).toEqual([]);
  expect(packageResult.candidates).toHaveLength(8);
});

test("HTML ativo, DOCX inválido e referências externas são tratados com segurança", async ({
  page
}) => {
  await page.setContent("<!doctype html><title>Validação isolada dos parsers</title>");
  await page.addScriptTag({ content: importerScript });
  const result = await page.evaluate(async () => {
    const api = (globalThis as unknown as { legalTest: typeof LegalImport }).legalTest;
    const sanitized = api.htmlLegalText(
      '<h1>Política de Garantia</h1><p><strong>90 dias</strong> de garantia legal. <a href="javascript:alert(1)">Link ativo</a></p><script>alert(1)</script><iframe src="https://example.invalid"></iframe>'
    );
    return {
      sanitized,
      bad: await api.importLegalFiles([new File(["Não sou um DOCX"], "garantia.docx")])
    };
  });
  expect(result.sanitized).toContain("**90 dias**");
  expect(result.sanitized).not.toMatch(/script|iframe|javascript|alert/u);
  expect(result.bad.candidates).toHaveLength(0);
  expect(result.bad.errors).toHaveLength(1);
});

test("tela real com respostas isoladas: mobile, teclado, minutas e conflito", async ({
  page,
  context
}) => {
  const payload = Buffer.from(
    JSON.stringify({
      email: "gerencia.demo@curtiz.local",
      fullName: "Gerência Demo",
      role: "manager",
      roles: ["manager"],
      expiresAt: Date.now() + 3600000
    })
  ).toString("base64url");
  const signature = createHmac("sha256", "legal-policy-isolated-test-session-secret")
    .update(payload)
    .digest("base64url");
  await context.addCookies([
    {
      name: "curtiz-demo-session",
      value: `${payload}.${signature}`,
      domain: "localhost",
      path: "/"
    }
  ]);
  const documents: Record<string, unknown>[] = [],
    sections: Record<string, unknown>[] = [];
  const calls: Record<string, unknown>[] = [];
  await page.route("**/api/legal/policies", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          documents,
          sections,
          company: { completeness_status: "complete" },
          capabilities: { "legal_content.edit": true, "legal_content.publish": true }
        }
      });
      return;
    }
    const data = route.request().postDataJSON() as Record<string, unknown>;
    calls.push(data);
    const document = {
      id: `a1000000-0000-4000-8000-${String(documents.length + 1).padStart(12, "0")}`,
      slug: data.slug,
      public_title: data.title,
      status: "draft",
      updated_at: new Date().toISOString()
    };
    documents.push(document);
    sections.push(
      ...(data.sections as Record<string, unknown>[]).map((section) => ({
        ...section,
        document_id: document.id
      }))
    );
    await route.fulfill({ json: { result: { document, unchanged: false } } });
  });
  await page.goto("/gerencia/politicas");
  await expect(page.getByRole("heading", { name: "Arraste suas políticas aqui" })).toBeVisible();
  expect(await page.locator(".legal-policy-row").count()).toBe(8);
  for (const width of [320, 360, 390, 430, 600, 601, 768, 1024, 1025, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    const button = page.getByRole("button", { name: "Selecionar arquivos" });
    await expect(button).toBeEnabled();
    await button.focus();
    await expect(button).toBeFocused();
  }
  await page.screenshot({
    path: test.info().outputPath("legal-policies-desktop.png"),
    fullPage: true
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.getByRole("button", { name: "Selecionar arquivos" }).press("Enter")
  ]);
  await chooser.setFiles({
    name: "02-politica-de-privacidade.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Política de Privacidade\n1 Responsável\nA empresa é [RAZAO_SOCIAL] com [CNPJ]."
    )
  });
  await expect(page.getByText("Minuta salva.", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.slug).toBe("aviso-de-privacidade");
  await expect(page.getByRole("button", { name: /Publicar políticas prontas/u })).toBeDisabled();
  const privacyRow = page
    .locator(".legal-policy-row")
    .filter({ hasText: "Política de Privacidade" });
  await privacyRow.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Editar minuta:/u })).toBeFocused();
  await expect(page.getByLabel("Texto completo")).toContainText("[RAZAO_SOCIAL]");
  await page.getByRole("button", { name: "Fechar editor sem salvar" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "garantia.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Política de Garantia\n1 Garantia\nA garantia preserva 90 dias de direitos legais."
      )
    },
    {
      name: "07-garantia.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Política de Garantia\n1 Garantia\nA garantia preserva 30 dias de direitos legais."
      )
    }
  ]);
  await expect(
    page.getByText("Há versões com diferenças reais. Confira o conteúdo e escolha qual salvar.")
  ).toHaveCount(2);
  expect(calls).toHaveLength(1);
  await page.getByRole("button", { name: "Usar esta versão e salvar minuta" }).first().click();
  await expect(page.getByText("Minuta salva.", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("legal-policies-mobile.png"),
    fullPage: true
  });
});

test("API real recusa acesso sem sessão e origem externa", async ({ request }) => {
  expect((await request.get("/api/legal/policies")).status()).toBe(401);
  expect(
    (
      await request.post("/api/legal/policies", {
        headers: { origin: "https://example.invalid" },
        data: { action: "publish" }
      })
    ).status()
  ).toBe(403);
});
