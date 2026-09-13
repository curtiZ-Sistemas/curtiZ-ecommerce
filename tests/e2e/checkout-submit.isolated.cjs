// Real checkout form with isolated cart, profile and preparation responses.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      resolveDir: resolve("apps/store"), loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import CheckoutPage from "./src/app/checkout/page";
        const lines = [{ productId: "33333333-3333-4333-8333-333333333333",
          variantId: "44444444-4444-4444-8444-444444444444", name: "Produto Teste",
          image: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", color: "Preto", size: "39", quantity: 1, unitPriceInCents: 5100 }];
        window.__cart = { hydrated: true, lines, selectedLines: lines, removeMany() {} };
        window.__router = { replace() {}, push() {} };
        sessionStorage.setItem("curtiz-checkout-idempotency", "a".repeat(36));
        window.__brickCreates = 0;
        window.MercadoPago = class {
          bricks() { return { create: async (type, container, settings) => {
            window.__brickCreates++; window.__brickCallbacks = settings.callbacks;
            settings.callbacks.onReady(); return { unmount() {} };
          } }; }
        };
        createRoot(document.getElementById("root")).render(<CheckoutPage />);
      `
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    alias: { "@": resolve("apps/store/src") },
    plugins: [{ name: "checkout-fixtures", setup(build) {
      const fixtures = {
        "next/link": 'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}',
        "next/image": 'export default function Image({src,alt,width,height}){return <img src={src} alt={alt} width={width} height={height} />}',
        "next/script": 'export default function Script(){return null}',
        "next/navigation": 'export const useRouter=()=>window.__router;',
        "cart-provider": 'export const useCart=()=>window.__cart;',
        "intelligence-client": 'export function trackIntelligence(){}'
      };
      build.onResolve({ filter: /^(next\/(link|image|script|navigation))$|cart-provider$|intelligence-client$/ }, args => {
        const path = args.path.startsWith("next/") ? args.path : args.path.split("/").pop();
        return { path, namespace: "fixture" };
      });
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        loader: "jsx", contents: fixtures[args.path], resolveDir: resolve("apps/store")
      }));
    } }],
    define: { "process.env.NODE_ENV": '"production"' }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    let profileRelease, prepareRelease;
    const requests = [];
    const address = { id: "77777777-7777-4777-8777-777777777777", label: "Casa", postalCode: "01310100",
      street: "Av Paulista", number: "1", complement: "", district: "Bela Vista", city: "Sao Paulo", state: "SP", isDefault: true };
    await page.route("https://checkout.test/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/api/checkout/profile") return new Promise(resolve => {
        profileRelease = () => resolve(route.fulfill({ contentType: "application/json", body: JSON.stringify({
          profile: { fullName: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpfLastFour: "4725" }, addresses: [address]
        }) }));
      });
      if (path === "/api/checkout") {
        requests.push(route.request().postDataJSON());
        return new Promise(resolve => {
          prepareRelease = (status, body) => resolve(route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
        });
      }
      if (path === "/api/checkout/payment") return route.fulfill({ status: 409, contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "CUSTOMER_IDENTITY_REQUIRED", recovery: "review_checkout",
          message: "Informe e salve o CPF do cliente no checkout." }) });
      if (path.startsWith("/api/")) throw new Error(`Unexpected checkout request: ${path}`);
      return route.fulfill({ contentType: "text/html", body: '<script nonce="request-nonce"></script><div id="root"></div><script src="/app.js"></script>' });
    });
    const profileHit = page.waitForRequest("**/api/checkout/profile");
    await page.goto("https://checkout.test/checkout");
    await profileHit;
    const button = page.getByRole("button", { name: "Continuar para pagamento" });
    assert.equal(await button.isDisabled(), true);
    profileRelease();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.locator('input[name="cpf"]').getAttribute("type"), "hidden");

    const firstHit = page.waitForRequest("**/api/checkout");
    await page.locator("form").evaluate(form => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await firstHit;
    assert.equal(requests.length, 1, "Two synchronous form submissions must prepare only one checkout");
    assert.match(requests[0].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "Corrupt stored logical keys must be replaced before preparation");
    prepareRelease(409, { ok: false, code: "CHECKOUT_CHANGED", message: "Itens mudaram. Revise o checkout." });
    await page.getByRole("alert").filter({ hasText: "Itens mudaram. Revise o checkout." }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);

    const nextHit = page.waitForRequest("**/api/checkout");
    await button.click();
    await nextHit;
    assert.equal(requests.length, 2);
    assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey, "Preparation retry keeps logical checkout identity");
    assert.equal(requests[1].customer.cpf, "", "Saved identity is resolved by the server, never by provider CPF");
    prepareRelease(200, { ok: true, paymentMode: "test", publicKey: "TEST-public-key", subtotalInCents: 5100,
      discountInCents: 0, couponName: "", shippingInCents: 1690, amountInCents: 6790 });
    await page.getByRole("heading", { name: "Finalize seu pedido" }).waitFor();
    await page.waitForFunction(() => window.__brickCreates === 1);
    await page.evaluate(async () => {
      try { await window.__brickCallbacks.onSubmit({ formData: { payment_method_id: "visa", token: "test-card-token",
        payer: { identification: { type: "CPF", number: "12345678909" } } } }); } catch { /* Expected identity conflict. */ }
    });
    await page.getByRole("button", { name: "Revisar checkout" }).click();
    await page.locator('input[name="cpf"][type="text"], input[name="cpf"]:not([type])').waitFor();
    assert.equal(await page.locator('input[name="name"]').inputValue(), "Cliente Teste", "Recovery preserves customer fields");
    await page.locator('input[name="cpf"]').fill("52998224725");
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    console.log(JSON.stringify({ result: "PASS", savedCpfEnablesContinue: true, concurrentPreparationBlocked: true,
      retryAfter409: true, logicalKeyPreserved: true, missingSavedIdentityRecoverable: true, brickCreates: 1 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
