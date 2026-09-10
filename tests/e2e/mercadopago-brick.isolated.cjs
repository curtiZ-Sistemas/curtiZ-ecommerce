// Isolated browser regression: real component lifecycle with a mocked Mercado Pago SDK.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { MercadoPagoPaymentBrick } from "./src/components/mercadopago-payment-brick";
        window.__probe = { creates: 0, unmounts: 0, ready: 0 };
        window.MercadoPago = class {
          constructor(publicKey, options) { window.__probe.publicKey = publicKey; window.__probe.options = options; }
          bricks() { return { create: async (_type, container, settings) => {
            window.__probe.creates += 1;
            window.__probe.container = container;
            window.__probe.settings = settings;
            settings.callbacks.onReady();
            return { unmount: () => { window.__probe.unmounts += 1; } };
          } }; }
        };
        const session = { orderId: "order", orderCode: "CZ-123", subtotalInCents: 5100, shippingInCents: 1690, amountInCents: 6790, publicKey: "TEST-public-key", idempotencyKey: "key", email: "cliente@example.com", cpf: "12345678909" };
        window.__root = createRoot(document.getElementById("root"));
        window.__root.render(<MercadoPagoPaymentBrick session={session} onComplete={() => {}} />);
      `,
      resolveDir: resolve("apps/store"),
      loader: "tsx"
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    alias: { "@": resolve("apps/store/src") },
    plugins: [{
      name: "mock-next-script",
      setup(build) {
        build.onResolve({ filter: /^next\/script$/ }, () => ({ path: "next-script", namespace: "mock" }));
        build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "jsx", contents: "export default function Script(){ return null }" }));
      }
    }],
    define: { "process.env.NODE_ENV": '"production"' }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://brick.test/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      return route.fulfill({
        contentType: "text/html",
        body: '<script nonce="request-nonce"></script><div id="root"></div><script src="/app.js"></script>'
      });
    });
    await page.goto("http://brick.test/");
    await page.getByText("Finalize seu pedido").waitFor();
    await page.waitForFunction(() => window.__probe?.creates === 1);
    const probe = await page.evaluate(() => ({
      ...window.__probe,
      amount: window.__probe.settings.initialization.amount,
      amountType: typeof window.__probe.settings.initialization.amount
    }));
    if (probe.amount !== 67.9 || probe.amountType !== "number") throw new Error("Invalid Brick amount");
    if (probe.options.deviceProfileCspNonce !== "request-nonce") throw new Error("CSP nonce not forwarded");
    if (probe.creates !== 1) throw new Error("Brick initialized more than once");
    await page.evaluate(() => window.__root.unmount());
    await page.waitForFunction(() => window.__probe?.unmounts === 1);
    console.log(JSON.stringify({ result: "PASS", amount: probe.amount, nonceForwarded: true, creates: probe.creates }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
