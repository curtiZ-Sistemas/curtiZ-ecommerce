// Isolated browser regression for the store color-filter swatches.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ColorSwatch} from './src/components/color-swatch'; const colors=[['Bege Strass','#d8c3a5'],['Branco Strass','#ffffff'],['Lilás Strass','#b57edc'],['Preto e Branco Strass','#000000','#ffffff']]; createRoot(document.getElementById('root')).render(<div className="filter-option-list color-filter-list">{colors.map(([name,primary,secondary])=><label key={name}><input type="checkbox"/><ColorSwatch className="filter-color-preview" name={name} primaryColor={primary} secondaryColor={secondary} decorative/><span>{name}</span><small>1</small></label>)}</div>);`,
      resolveDir: resolve("apps/store"),
      loader: "tsx"
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    alias: { "@": resolve("apps/store/src") },
    define: { "process.env.NODE_ENV": '"production"' }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost:43128/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/style.css") return route.fulfill({ contentType: "text/css", body: readFileSync("apps/store/src/app/globals.css", "utf8") });
      return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
    });
    await page.goto("http://localhost:43128/");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await page.locator(".filter-color-preview").evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width: box.width, height: box.height, radius: style.borderRadius, flex: style.flex };
      }));
      assert.equal(geometry.length, 4, `Each color remains an independent option at ${width}px`);
      geometry.forEach((swatch) => {
        assert.equal(swatch.width, 17, `Swatch width stays fixed at ${width}px`);
        assert.equal(swatch.height, 17, `Swatch height stays fixed at ${width}px`);
        assert.equal(swatch.radius, "50%", `Swatch stays circular at ${width}px`);
        assert.match(swatch.flex, /^0 0 17px/, `Swatch cannot grow or shrink at ${width}px`);
      });
    }
    const twoTone = page.locator(".filter-color-preview").last();
    const background = await twoTone.evaluate((element) => getComputedStyle(element).backgroundImage);
    assert(background.includes("linear-gradient") && background.includes("50%"), "Two-tone swatch is one circle split 50/50");
  } finally {
    await browser.close();
  }
  console.log("Isolated store color-filter swatch checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
