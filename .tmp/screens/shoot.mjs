import { chromium } from "@playwright/test";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const colors = ["Bege + Branco","Branco","Lilás + Preto","Preto","Preto + Bege","Lilás + Branco"];
const sizes = ["34","35","36","37","38","39"];
let n = 1;
const mk = (extra) => colors.flatMap(color => sizes.map(size => ({
  variantId: uuid(n++), color, size, pairsPerSku: 2, unitPriceInCents: 4500,
  available: (n % 5 === 0) ? 0 : 6 + (n % 7), imageUrl: "", imageAlt: `Kit ${color}`, ...extra(color, size)
})));
const cat = (extra) => ({
  checkoutConfigured: true, orderHistoryAvailable: true, total: 3, nextOffset: null, colors, sizes,
  items: [
    { productId: uuid(900), name: "Kit 2 Chinelos Femininos com Pedraria – Confortáveis e Versáteis", variants: mk(extra) },
    { productId: uuid(901), name: "Kit 2 Chinelos Femininos com Pedraria – Praia e Dia a Dia", variants: mk(extra) },
    { productId: uuid(902), name: "Kit 3 Rasteiras Básicas", variants: mk(extra).slice(0, 8) }
  ]
});
const browser = await chromium.launch();
for (const w of [390, 768, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  const login = await page.request.post("http://localhost:3300/api/auth/login", {
    headers: { origin: "http://localhost:3300" }, data: { email: "representante.demo@curtiz.local", password: "1234567890" } });
  console.log("login rep", login.status());
  await page.route("**/api/representatives/kits/catalog?*", r => r.fulfill({ json: cat(() => ({})) }));
  await page.route("**/api/representatives/kits/grades", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/representatives/kits/collection", r => r.fulfill({ json: { quote: null } }));
  await page.route("**/api/checkout/profile", r => r.fulfill({ json: { addresses: [] } }));
  await page.goto("http://localhost:3300/representante/comprar-kit", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const rb = page.getByRole("button", { name: "Recusar opcionais" });
  if (await rb.count()) await rb.click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `.tmp/screens/rep-catalog-${w}.png`, fullPage: true });
  console.log(w, "scrollW", await page.evaluate(() => document.documentElement.scrollWidth));
  await ctx.close();

  const c2 = await browser.newContext({ viewport: { width: w, height: 900 } });
  const p2 = await c2.newPage();
  const l2 = await p2.request.post("http://localhost:3300/api/auth/login", {
    headers: { origin: "http://localhost:3300" }, data: { email: "admin.demo@curtiz.local", password: "1234567890" } });
  console.log("login admin", l2.status());
  const ck = (await p2.request.storageState()).cookies;
  await c2.addCookies(ck.map(c => ({ ...c, domain: "localhost", path: "/" })));
  await p2.route("**/api/admin/resources/kits?catalog=true*", r => r.fulfill({ json: cat(() => ({ sku: "SHOPEE-5B217217362-X" })) }));
  await p2.goto("http://localhost:3301/administracao/kits", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(6000);
  await p2.screenshot({ path: `.tmp/screens/admin-kits-${w}.png`, fullPage: true });
  console.log(w, "admin scrollW", await p2.evaluate(() => document.documentElement.scrollWidth), p2.url());
  await c2.close();
}
await browser.close();
