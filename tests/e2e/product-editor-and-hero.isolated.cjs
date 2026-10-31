// Isolated browser regression with mocked catalog responses; never writes Supabase data.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProductManagement} from './src/components/product-management'; import {HomepageHero} from '../store/src/components/homepage-hero'; const banners=[{id:'a',title:'A',altText:'A',desktopImage:'/desktop-a.png',mobileImage:'/mobile-a.png',position:'hero'},{id:'b',title:'B',altText:'B',desktopImage:'/desktop-b.png',mobileImage:'/mobile-b.png',position:'hero'}]; createRoot(document.getElementById('root')).render(location.pathname==='/hero'?<HomepageHero banners={banners}/>:<ProductManagement draftOwnerKey='isolated-admin'/>);`,
      resolveDir: resolve("apps/panel"), loader: "tsx"
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    alias: { "@": resolve("apps/panel/src") },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_STORE_URL": '"http://localhost:43127"',
      "process.env.SUPABASE_URL": '"http://localhost:43127"' }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=", "base64");
    const productId = "20000000-0000-4000-8000-000000000001";
    let product = { id: productId, name: "Produto de teste", slug: "produto-de-teste", status: "draft",
      priceInCents: 5000, stock: 2, variants: [{ id: "30000000-0000-4000-8000-000000000001",
        sku: "TEST-PRETO-34", color: "Preto", colorHex: "#000000", colorHexSecondary: "",
        size: "34", active: true, available: 2, reserved: 0, sellable: 2 }], sizeGuide: [], specifications: [] };
    const saves = [];
    let productDraft = null;
    let holdNextDraftPut = false;
    let releaseDraftPut = null;
    let nextDraftPutStatus = 0;
    let draftPutCount = 0;
    let failNextProductSave = false;
    let failedSaves = 0;
    const route = async (requestRoute) => {
      const request = requestRoute.request();
      const path = new URL(request.url()).pathname;
      const json = (body, status = 200) => requestRoute.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/" || path === "/hero") return requestRoute.fulfill({ contentType: "text/html",
        body: '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (path === "/app.js") return requestRoute.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/style.css") return requestRoute.fulfill({ contentType: "text/css", body: readFileSync("apps/panel/src/app/globals.css", "utf8") });
      if (path === "/api/catalog/product-draft") {
        if (request.method() === "GET") return json({ ok: true, draft: productDraft });
        if (request.method() === "DELETE") { productDraft = null; return json({ ok: true }); }
        draftPutCount++;
        const candidate = request.postDataJSON();
        if (holdNextDraftPut) {
          holdNextDraftPut = false;
          await new Promise((resolve) => { releaseDraftPut = resolve; });
        }
        if (nextDraftPutStatus) {
          const status = nextDraftPutStatus;
          nextDraftPutStatus = 0;
          return json({ message: "Draft sync test failure" }, status);
        }
        if (!productDraft || Date.parse(candidate.savedAt) >= Date.parse(productDraft.savedAt)) productDraft = candidate;
        return json({ ok: true, savedAt: productDraft.savedAt });
      }
      if (path === "/api/catalog/products" && request.method() === "PATCH") {
        const payload = request.postDataJSON();
        if (failNextProductSave) {
          failNextProductSave = false;
          failedSaves++;
          return json({ message: "Não foi possível salvar o produto agora.", requestId: "12345678-1234-4234-8234-123456789012" }, 503);
        }
        saves.push(payload);
        product = { ...product, name: payload.name, slug: payload.slug || product.slug,
          description: payload.description, sizeGuide: payload.sizeGuide, specifications: payload.specifications };
        productDraft = null;
        return json({ ok: true, productId, message: "Produto salvo" });
      }
      if (path === "/api/catalog/products") return json({ products: [product], total: 1, pageSize: 20,
        categories: [], models: [], collections: [], colorOptions: [
          { name: "Preto e Branco", primaryColor: "#000000", secondaryColor: "#FFFFFF" }
        ], capabilities: { create: true, update: true, adjustStock: true, archive: true } });
      return requestRoute.fulfill({ contentType: "image/png", body: png });
    };

    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    page.on("pageerror", (error) => { throw error; });
    await page.route("http://localhost:43127/**", route);
    await page.goto("http://localhost:43127/");
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.getByText("Descartar alterações?").count(), 0, "Unchanged editor closes directly");
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    dialog = page.getByRole("dialog");
    const name = dialog.locator('input[name="name"]');
    await name.fill("Produto alterado");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByText("Descartar alterações?").waitFor();
    await page.getByRole("button", { name: "Continuar editando" }).click();
    await name.fill("Produto de teste");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.getByText("Descartar alterações?").count(), 0, "Reverted editor closes directly");

    await page.getByRole("button", { name: "Editar", exact: true }).click();
    dialog = page.getByRole("dialog");
    const colorGroup = dialog.locator(".variant-color-group").first();
    await colorGroup.locator(".existing-color-picker summary").click();
    await colorGroup.getByRole("button", { name: /Preto e Branco/ }).click();
    assert.equal(await colorGroup.locator(".variant-color-name input").inputValue(), "Preto e Branco");
    assert.equal(await colorGroup.locator('input[type="color"]').nth(0).inputValue(), "#000000");
    assert.equal(await colorGroup.locator('input[type="color"]').nth(1).inputValue(), "#ffffff");
    const previewBackground = await colorGroup.locator(".variant-color-swatch").evaluate((element) => getComputedStyle(element).backgroundImage);
    assert(previewBackground.includes("linear-gradient") && previewBackground.includes("50%"), "Two-tone preview is split 50/50");
    await page.setViewportSize({ width: 390, height: 850 });
    const colorGeometry = await colorGroup.evaluate((element) => ({
      group: element.getBoundingClientRect().right,
      panel: element.closest(".panel-drawer").getBoundingClientRect().right
    }));
    assert(colorGeometry.group <= colorGeometry.panel + 1, "Two-tone editor fits mobile width");
    await dialog.getByRole("button", { name: "Salvar alterações" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(saves.at(-1).variants[0].colorHexSecondary, "#FFFFFF");

    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const backdrop = page.locator(".panel-drawer-backdrop");
    await backdrop.waitFor();
    const backdropStyle = await backdrop.evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      opacity: getComputedStyle(element).opacity
    }));
    assert.notEqual(backdropStyle.backgroundColor, "rgba(0, 0, 0, 0)", "Drawer backdrop is visibly colored");
    assert.notEqual(backdropStyle.opacity, "0", "Drawer backdrop is not transparent");

    await dialog.locator('input[name="name"]').fill("Cadastro entre sessões");
    await page.waitForTimeout(1150);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByText("Salvar rascunho e fechar?").waitFor();
    await page.getByRole("button", { name: "Salvar rascunho e fechar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(productDraft.fields.name, "Cadastro entre sessões", "Closing flushes the latest server draft");
    await page.evaluate(() => localStorage.clear());
    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.getByText("Encontramos um cadastro não concluído.").waitFor();
    await dialog.getByRole("button", { name: "Continuar cadastro" }).click();
    await page.waitForFunction(() => document.querySelector('input[name="name"]')?.value === "Cadastro entre sessões");
    assert.equal(await dialog.locator('input[name="name"]').inputValue(), "Cadastro entre sessões", "Server draft survives empty localStorage");

    await dialog.locator('input[name="name"]').fill("Novo produto teste");
    await dialog.locator('input[name="price"]').fill("50");
    const guide = dialog.locator(".product-size-guide-editor");
    await guide.getByRole("button", { name: "Adicionar linha" }).click();
    let rows = guide.locator(".product-size-guide-row");
    const size = rows.first().locator("input").first();
    await size.click();
    await page.keyboard.type("34");
    assert.equal(await size.inputValue(), "34", "Typing does not remount the size input");
    assert(await size.evaluate((element) => document.activeElement === element), "Size retains focus");
    await page.keyboard.press("Tab");
    assert(await rows.first().locator("input").nth(1).evaluate((element) => document.activeElement === element), "Tab reaches measurement");
    await rows.first().locator("input").nth(1).fill("23");
    await guide.getByRole("button", { name: "Adicionar linha" }).click();
    rows = guide.locator(".product-size-guide-row");
    await rows.nth(1).locator("input").first().fill("35");
    await rows.nth(1).locator("input").nth(1).fill("24.5");
    await rows.nth(1).getByRole("button", { name: /Remover tamanho/ }).click();
    assert.equal(await rows.count(), 1);

    const details = dialog.locator(".product-specifications-editor");
    await details.getByRole("button", { name: "Adicionar detalhe" }).click();
    await details.getByRole("button", { name: "Adicionar detalhe" }).click();
    const detailRows = details.locator(".product-specification-row");
    await detailRows.nth(0).locator("input").nth(0).fill("Marca");
    await detailRows.nth(0).locator("input").nth(1).fill("Marca de teste");
    await detailRows.nth(1).locator("input").nth(0).fill("Material");
    await detailRows.nth(1).locator("input").nth(1).fill("Borracha");
    await detailRows.nth(1).getByRole("button", { name: "Mover detalhe 2 para cima" }).click();
    for (const width of [320, 390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      const geometry = await guide.locator(".product-size-guide-row").first().evaluate((element) => ({
        row: element.getBoundingClientRect().right,
        panel: element.closest(".panel-drawer").getBoundingClientRect().right,
        button: element.querySelector("button").getBoundingClientRect().right
      }));
      assert(geometry.row <= geometry.panel + 1 && geometry.button <= geometry.row + 1, `Guide fits ${width}px`);
    }
    await dialog.getByRole("button", { name: "Salvar produto" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(saves.at(-1).sizeGuide, [{ size: "34", measurementCm: 23 }]);
    assert.deepEqual(saves.at(-1).specifications, [
      { label: "Material", value: "Borracha" }, { label: "Marca", value: "Marca de teste" }
    ]);
    assert.equal(productDraft, null, "Successful product creation removes the server draft");

    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill("Rascunho para descartar");
    await page.waitForTimeout(1150);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar rascunho e fechar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.evaluate(() => localStorage.clear());
    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.getByText("Encontramos um cadastro não concluído.").waitFor();
    await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
    assert.equal(productDraft, null, "Discard removes the server draft");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    holdNextDraftPut = true;
    await dialog.locator('input[name="name"]').fill("Primeiro autosave");
    for (let attempt = 0; attempt < 20 && !releaseDraftPut; attempt++) await page.waitForTimeout(100);
    assert(releaseDraftPut, "First autosave starts and is held in flight");
    await dialog.locator('input[name="name"]').fill("Último autosave");
    await page.waitForTimeout(1150);
    releaseDraftPut();
    for (let attempt = 0; attempt < 20 && productDraft?.fields?.name !== "Último autosave"; attempt++) await page.waitForTimeout(100);
    assert.equal(productDraft?.fields?.name, "Último autosave", "Rapid autosaves keep only the latest snapshot");
    const putsBeforeInvalidSnapshot = draftPutCount;
    nextDraftPutStatus = 400;
    await dialog.locator('input[name="name"]').fill("Snapshot rejeitado");
    for (let attempt = 0; attempt < 20 && draftPutCount === putsBeforeInvalidSnapshot; attempt++) await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    assert.equal(draftPutCount, putsBeforeInvalidSnapshot + 1, "A rejected snapshot is not retried in a loop");
    const localRejectedDraft = await page.evaluate(() => JSON.parse(localStorage.getItem("curtiz:product-draft:v1:isolated-admin")));
    assert.equal(localRejectedDraft.fields.name, "Snapshot rejeitado", "A 400 response preserves the local fallback");
    nextDraftPutStatus = 503;
    await dialog.locator('input[name="name"]').fill("Snapshot aguardando rede");
    const putsBeforeRetry = draftPutCount;
    for (let attempt = 0; attempt < 20 && draftPutCount === putsBeforeRetry; attempt++) await page.waitForTimeout(100);
    const localUnavailableDraft = await page.evaluate(() => JSON.parse(localStorage.getItem("curtiz:product-draft:v1:isolated-admin")));
    assert.equal(localUnavailableDraft.fields.name, "Snapshot aguardando rede", "A 503 response preserves the local fallback");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    for (let attempt = 0; attempt < 20 && productDraft?.fields?.name !== "Snapshot aguardando rede"; attempt++) await page.waitForTimeout(100);
    assert.equal(productDraft?.fields?.name, "Snapshot aguardando rede", "A transient failure retries the newest snapshot later");
    failNextProductSave = true;
    await dialog.locator('input[name="price"]').fill("50");
    await dialog.getByRole("button", { name: "Salvar produto" }).click();
    await dialog.getByText(/Referência: 12345678-1234-4234-8234-123456789012/).waitFor({ timeout: 5000 }).catch(async () => {
      throw new Error(`Expected save failure reference; failedSaves=${failedSaves}; dialog=${(await dialog.innerText()).slice(-1000)}`);
    });
    assert.equal(productDraft?.fields?.name, "Snapshot aguardando rede", "Failed product save keeps the draft");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Salvar rascunho e fechar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.getByText("Encontramos um cadastro não concluído.").waitFor();
    await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto("http://localhost:43127/hero");
    const image = page.locator(".hero-media");
    await image.waitFor();
    assert((await image.getAttribute("src")).includes("desktop-a"));
    await page.waitForTimeout(3250);
    assert((await image.getAttribute("src")).includes("desktop-b"), "Desktop advances automatically");
    await page.getByRole("button", { name: "Próximo banner" }).click();
    assert((await image.getAttribute("src")).includes("desktop-a"), "Manual navigation still works");
    await page.waitForTimeout(3250);
    assert((await image.getAttribute("src")).includes("desktop-b"), "Manual navigation restarts the timer");
    await page.setViewportSize({ width: 390, height: 850 });
    await page.reload();
    await page.waitForTimeout(3250);
    assert((await image.getAttribute("src")).includes("desktop-b"), "Mobile also advances automatically");
    await page.close();

    const reducedPage = await browser.newPage({ reducedMotion: "reduce" });
    await reducedPage.route("http://localhost:43127/**", route);
    await reducedPage.goto("http://localhost:43127/hero");
    await reducedPage.waitForTimeout(3250);
    assert((await reducedPage.locator(".hero-media").getAttribute("src")).includes("desktop-a"), "Reduced motion stops autoplay");
    await reducedPage.close();
    console.log("Isolated product editor and hero checks passed");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
