// Browser regression for document CSP across client navigation. No payment is submitted.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const storeRequire = createRequire(resolve("apps/store/package.json"));
  const policyBuild = await esbuild.build({
    stdin: {
      contents: 'export { middleware } from "./src/middleware";',
      resolveDir: resolve("apps/store"), loader: "ts"
    },
    bundle: true, write: false, platform: "node", format: "cjs",
    external: ["next/server", "@supabase/ssr"]
  });
  const policyModule = { exports: {} };
  new Function("require", "module", "exports", policyBuild.outputFiles[0].text)(
    storeRequire, policyModule, policyModule.exports
  );
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
  const { NextRequest } = storeRequire("next/server");
  const policies = new Map();
  const orderPayment = "/pedido/11111111-1111-4111-8111-111111111111/pagamento";
  for (const path of ["/carrinho", "/checkout", orderPayment]) {
    const response = await policyModule.exports.middleware(new NextRequest(`https://payment.test${path}`));
    policies.set(path, response.headers.get("content-security-policy"));
  }

  const clientBuild = await esbuild.build({
    stdin: {
      contents: `
        import React, { useEffect, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { PaymentDocumentBoundary } from "./src/components/payment-document-boundary";
        function PaymentProbe() {
          useEffect(() => {
            window.__mounts++;
            fetch("https://api.mercadopago.com/v1/devices/widgets", {method:"POST",body:"{}"})
              .then(r => { window.__widgetStatus=r.status; }).catch(() => {});
            fetch("https://api.mercadopago.com/v1/payment_methods/search")
              .then(r => { window.__searchStatus=r.status; }).catch(() => {});
          }, []);
          return <div>Payment probe</div>;
        }
        function App() {
          const [path, setPath] = useState(location.pathname);
          window.__navigate = next => { history.pushState({}, "", next); setPath(next); };
          window.__path = path;
          const child = path === "/carrinho" ? <div>Cart probe</div> : <PaymentProbe />;
          return window.__bypass ? child : <PaymentDocumentBoundary mercadoPagoAllowed={window.__allowed}>{child}</PaymentDocumentBoundary>;
        }
        createRoot(document.getElementById("root")).render(<App />);
      `,
      resolveDir: resolve("apps/store"), loader: "tsx"
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "pathname-fixture", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const usePathname = () => window.__path;" }));
    } }],
    define: { "process.env.NODE_ENV": '"production"' }
  });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const bypass of [true, false]) {
      for (const destination of ["/checkout", orderPayment]) {
        const page = await browser.newPage();
        let documents = 0, requests = 0;
        await page.route("https://api.mercadopago.com/**", route => {
          requests++;
          return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "https://payment.test" }, body: "{}" });
        });
        await page.route("https://payment.test/**", route => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: clientBuild.outputFiles[0].text });
          documents++;
          const csp = policies.get(path);
          const nonce = csp.match(/'nonce-([^']+)'/u)[1];
          return route.fulfill({
            contentType: "text/html", headers: { "content-security-policy": csp },
            body: `<div id="root"></div><script nonce="${nonce}">window.__allowed=${path !== "/carrinho"};window.__bypass=${bypass};window.__mounts=0;window.__violations=[];document.addEventListener("securitypolicyviolation",e=>window.__violations.push({origin:new URL(e.blockedURI).origin,directive:e.effectiveDirective}));</script><script nonce="${nonce}" src="/app.js"></script>`
          });
        });
        await page.goto("https://payment.test/carrinho");
        await page.getByText("Cart probe").waitFor();
        await page.evaluate(() => sessionStorage.setItem("cart-preservation-probe", "saved"));
        await page.evaluate(path => window.__navigate(path), destination);
        if (bypass) {
          await page.waitForFunction(() => window.__violations.length === 2);
          assert.equal(documents, 1);
          assert.equal(requests, 0);
          assert.deepEqual(await page.evaluate(() => window.__violations), [
            { origin: "https://api.mercadopago.com", directive: "connect-src" },
            { origin: "https://api.mercadopago.com", directive: "connect-src" }
          ]);
        } else {
          await page.waitForFunction(() => window.__widgetStatus === 200 && window.__searchStatus === 200);
          assert.equal(documents, 2);
          assert.equal(requests, 2);
          assert.deepEqual(await page.evaluate(() => window.__violations), []);
          assert.equal(await page.evaluate(() => window.__mounts), 1);
          assert.equal(await page.evaluate(() => sessionStorage.getItem("cart-preservation-probe")), "saved");
        }
        await page.close();
      }
    }
    console.log(JSON.stringify({ result: "PASS", cases: 4, inheritedCspBlocksRequests: true, documentNavigationRestoresCsp: true, sessionStoragePreserved: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
