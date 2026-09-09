// Isolated browser regression: mocked API; does not validate real Supabase persistence or RLS.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BannerManager} from './src/components/banner-manager'; import {HomepageHero} from '../store/src/components/homepage-hero'; createRoot(document.getElementById('root')).render(location.pathname === "/hero" ? <HomepageHero banners={[{id:"test",title:"Teste",altText:"Imagem de teste",desktopImage:"/desktop.png",mobileImage:"/mobile.png",href:"/produtos",mobileHref:"/ofertas",position:"hero"}]} /> : <BannerManager/>);`,
      resolveDir: resolve("apps/panel"),
      loader: "tsx"
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@/lib/responsive-storefront-image": resolve(
        "apps/store/src/lib/responsive-storefront-image.ts"
      ),
      "@": resolve("apps/panel/src")
    },
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_STORE_URL": '"http://banner.test"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://banner.test"'
    }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (error) => console.error("isolated browser:", error.message));
    let items = [],
      uploads = 0,
      failSave = true;
    const mutations = [];
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
      "base64"
    );
    await page.route("http://banner.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const reply = (data, status = 200) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (url.pathname === "/" || url.pathname === "/hero")
        return route.fulfill({
          contentType: "text/html",
          body: '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
        });
      if (url.pathname === "/style.css")
        return route.fulfill({
          contentType: "text/css",
          body: readFileSync("apps/panel/src/app/globals.css", "utf8")
        });
      if (url.pathname === "/app.js")
        return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (url.pathname.includes("banner-targets"))
        return reply({
          targets: [
            {
              id: "produtos",
              type: "internal_page",
              label: "Todos os produtos",
              route: "/produtos",
              detail: "Página"
            },
            {
              id: "ofertas",
              type: "internal_page",
              label: "Ofertas",
              route: "/ofertas",
              detail: "Página"
            }
          ]
        });
      if (url.pathname.includes("banner-media")) {
        if (req.method() === "DELETE") return reply({ message: "Removido" });
        uploads++;
        return reply(
          {
            path: `banners/10000000-0000-4000-8000-000000000001/desktop-10000000-0000-4000-8000-00000000000${uploads}.png`
          },
          201
        );
      }
      if (url.pathname.includes("/resources/banners")) {
        if (req.method() === "GET")
          return reply({
            items,
            total: items.length,
            capabilities: { create: true, update: true, delete: true, archive: true }
          });
        const body = req.postDataJSON();
        mutations.push({ method: req.method(), body });
        if (failSave) {
          failSave = false;
          return reply({ message: "Falha de salvamento simulada" }, 409);
        }
        if (req.method() === "DELETE") {
          items = [];
          return reply({ message: "Excluído" });
        }
        const row = {
          ...body.values,
          id: "10000000-0000-4000-8000-000000000005",
          status: "published"
        };
        items = [row];
        return reply({ item: row });
      }
      return route.fulfill({ contentType: "image/png", body: png });
    });
    await page.goto("http://banner.test/");
    await page.getByRole("button", { name: "Novo banner", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    if (await dialog.getByText("Título interno").count()) throw Error("Legacy field visible");
    for (const width of [320, 390, 600, 601, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await dialog.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        overflow: el.scrollWidth > el.clientWidth,
        columns: getComputedStyle(el.querySelector("fieldset")).gridTemplateColumns
      }));
      if (layout.width > width || layout.overflow) throw Error("Dialog overflow at " + width);
      console.log("viewport", width, JSON.stringify(layout));
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const dataTransfer = await page.evaluateHandle((base64) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "desktop.png", {
          type: "image/png"
        })
      );
      return dt;
    }, png.toString("base64"));
    await page.locator(".banner-drop-zone").first().dispatchEvent("drop", { dataTransfer });
    await page
      .locator("input[type=file]")
      .nth(1)
      .setInputFiles({ name: "mobile.png", mimeType: "image/png", buffer: png });
    await page.locator(".banner-destination-choice").first().click();
    await page.getByRole("button", { name: "Todos os produtos" }).click();
    await page.locator(".banner-destination-choice").nth(1).click();
    await page.getByRole("button", { name: "Ofertas", exact: false }).click();
    await page.getByRole("button", { name: "Salvar banner", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Falha de salvamento simulada" }).waitFor();
    if (!(await dialog.isVisible())) throw Error("Closed after failed save");
    await page.getByRole("button", { name: "Salvar banner", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    if (uploads !== 2) throw Error("Retry repeated uploads");
    if (items[0].destination_url !== "/produtos" || items[0].destination_url_mobile !== "/ofertas")
      throw Error("Destinations not independent");
    await page.getByRole("button", { name: "Editar banner" }).click();
    await page
      .locator("input[type=file]")
      .nth(1)
      .setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
    await page.locator(".banner-destination-choice").nth(1).click();
    await page.getByRole("button", { name: "Nenhum destino", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await dialog.waitFor({ state: "detached" });
    if (
      uploads !== 3 ||
      items[0].destination_type_mobile !== "none" ||
      items[0].destination_url !== "/produtos"
    )
      throw Error("Single-device edit regressed");
    await page.getByRole("button", { name: "Excluir banner" }).click();
    await dialog.getByRole("button", { name: "Excluir banner" }).click();
    await page.getByRole("heading", { name: "Nenhum banner cadastrado" }).waitFor();
    await page.goto("http://banner.test/hero");
    for (const [width, href, image] of [
      [1280, "/produtos", "/desktop.png"],
      [390, "/ofertas", "/mobile.png"],
      [700, "/ofertas", "/mobile.png"],
      [701, "/produtos", "/desktop.png"]
    ]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForFunction(
        ({ href, image }) =>
          document.querySelector("a:has(picture)")?.getAttribute("href") === href &&
          document.querySelector("picture img")?.currentSrc.endsWith(image),
        { href, image }
      );
      console.log("hero viewport", width, href, image);
    }
    console.log(
      JSON.stringify({
        result: "PASS",
        coverage:
          "Isolated UI with mocked API only: responsive dialog, drag-drop, file selection, independent destinations, failed-save retry, single-image edit, delete",
        uploads,
        mutations: mutations.length
      })
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
