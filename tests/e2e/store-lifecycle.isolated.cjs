// Real UI components with isolated API responses. Does not certify database persistence.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync, mkdirSync } = require("node:fs");
const { chromium, expect } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
(async () => {
  const built = await esbuild.build({
    stdin: { resolveDir: resolve("apps/store"), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {HomepageHero} from './src/components/homepage-hero';
      import {CookiePreferences} from './src/components/cookie-preferences';
      import {DeleteAccount} from './src/components/delete-account';
      import {CartProvider} from './src/components/cart-provider';
      import {FavoritesProvider} from './src/components/favorites-provider';
      import {SiteHeader} from './src/components/site-header';
      import CartPage from './src/app/carrinho/page';
      const banners=[1,2].map(id=>({id:String(id),title:'Campanha '+id,altText:'Campanha '+id,desktopImage:'/images/hero-curtiz-desktop.webp',mobileImage:'/images/hero-curtiz-mobile.webp',position:'hero'}));
      createRoot(document.getElementById('root')).render(<CartProvider><FavoritesProvider><SiteHeader navigation={[]}/>{location.pathname==='/cart'?<CartPage/>:location.pathname==='/account'?<DeleteAccount/>:<><HomepageHero banners={banners}/><CookiePreferences/></>}</FavoritesProvider></CartProvider>);
    ` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    alias: { "@": resolve("apps/store/src") },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-navigation", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `export const usePathname=()=>location.pathname; export const useRouter=()=>({refresh(){},push(){},replace(){}}); export const useSearchParams=()=>new URLSearchParams();` }));
    } }]
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    let deletionCalls = 0;
    await page.route("http://localhost:4179/**", async route => {
      const url = new URL(route.request().url());
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (["/", "/cart", "/account"].includes(url.pathname)) return route.fulfill({ contentType: "text/html", body: '<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: readFileSync("apps/store/src/app/globals.css", "utf8").replace(/@import[^;]+;/g, "") + " body { font-family: Arial, sans-serif; } button, input { font: inherit; }" });
      if (url.pathname === "/api/auth/session") return json({ authenticated: false });
      if (url.pathname === "/api/cart/availability") return json({ items: [{ variantId: "removed", available: false }] });
      if (url.pathname === "/api/privacy/cookies") return route.request().method() === "POST" ? json({ persisted: true }) : json({}, 503);
      if (url.pathname === "/api/customer/delete-account") { deletionCalls++; const body = route.request().postDataJSON(); return body.action === "verify" ? json({ token: "test-confirmation" }) : json({ message: "Falha controlada" }, 503); }
      if (url.pathname === "/_next/image") return route.fulfill({ contentType: "image/webp", body: readFileSync("apps/store/public/images/optimized/logo.webp") });
      if (url.pathname.startsWith("/images/") && !url.pathname.includes("..") && /\.(avif|webp)$/.test(url.pathname)) return route.fulfill({ contentType: url.pathname.endsWith(".avif") ? "image/avif" : "image/webp", body: readFileSync("apps/store/public" + url.pathname) });
      if (url.pathname.endsWith(".webp")) return route.fulfill({ contentType: "image/webp", body: readFileSync("apps/store/public/images/optimized/logo.webp") });
      return json({ items: [], products: [] });
    });
    for (const width of [320, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("http://localhost:4179/");
      const cookies = page.locator(".cookie-consent-card");
      await expect(cookies).toBeVisible();
      const text = await cookies.locator(".cookie-consent-heading p").boundingBox();
      if (!text || text.width < Math.min(230, width - 50)) throw new Error(`Cookie text squeezed at ${width}`);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      if (dimensions.scroll > dimensions.width) throw new Error(`Overflow at ${width}`);
      if (width === 390) { mkdirSync(".cache", { recursive: true }); await page.screenshot({ path: ".cache/store-mobile-cookies.png" }); }
      await page.getByRole("button", { name: "Recusar opcionais", exact: true }).click();
      await expect(cookies).toHaveCount(0);
      await page.getByRole("button", { name: "Próximo banner", exact: true }).click();
      await expect(page.locator(".hero-slide-count")).toHaveText("2 / 2 \u00b7 Pausado");
      await page.evaluate(() => localStorage.removeItem("curtiz-cookie-consent"));
    }
    await page.setViewportSize({ width: 390, height: 850 });
    mkdirSync(".cache", { recursive: true });
    await page.goto("http://localhost:4179/account");
    await page.getByRole("button", { name: "Excluir minha conta", exact: true }).click();
    await page.getByLabel("Senha atual").fill("test-password");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sim, excluir minha conta" })).toBeFocused();
    if (deletionCalls !== 1) throw new Error("Deletion executed before confirmation");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    if (deletionCalls !== 1) throw new Error("Cancel executed deletion");
    await page.evaluate(() => localStorage.setItem("curtiz-cart", JSON.stringify([{ productId: "p", variantId: "removed", name: "Produto retirado", image: "/image.webp", color: "Preto", size: "37", quantity: 1, unitPriceInCents: 1000 }])));
    await page.goto("http://localhost:4179/cart");
    await expect(page.locator(".cart-item.is-unavailable")).toBeVisible();
    await expect(page.locator(".cart-item input[type=checkbox]")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Aumentar quantidade de Produto retirado" })).toBeDisabled();
    await page.getByRole("button", { name: "Remover Produto retirado", exact: true }).click();
    await expect(page.locator(".cart-item")).toHaveCount(0);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("PASS: 5 widths; cookie text/overflow; carousel navigation; password confirmation/cancel; unavailable cart/removal.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
