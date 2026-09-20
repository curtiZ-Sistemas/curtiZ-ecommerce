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
      priceInCents: 5000, stock: 0, variants: [], sizeGuide: [], specifications: [] };
    const saves = [];
    const route = async (requestRoute) => {
      const request = requestRoute.request();
      const path = new URL(request.url()).pathname;
      const json = (body) => requestRoute.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/" || path === "/hero") return requestRoute.fulfill({ contentType: "text/html",
        body: '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (path === "/app.js") return requestRoute.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/style.css") return requestRoute.fulfill({ contentType: "text/css", body: readFileSync("apps/panel/src/app/globals.css", "utf8") });
      if (path === "/api/catalog/products" && request.method() === "PATCH") {
        const payload = request.postDataJSON();
        saves.push(payload);
        product = { ...product, name: payload.name, slug: payload.slug || product.slug,
          description: payload.description, sizeGuide: payload.sizeGuide, specifications: payload.specifications };
        return json({ ok: true, productId, message: "Produto salvo" });
      }
      if (path === "/api/catalog/products") return json({ products: [product], total: 1, pageSize: 20,
        categories: [], models: [], collections: [], capabilities: { create: true, update: true, adjustStock: true, archive: true } });
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

    await page.getByRole("button", { name: "Cadastrar produto" }).first().click();
    dialog = page.getByRole("dialog");
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
