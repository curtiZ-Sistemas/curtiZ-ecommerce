// Actual client components with isolated API fixtures; never submits a payment.
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { createRequire } = require("node:module");
const { resolve, join } = require("node:path");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: resolve("apps/store"), loader: "tsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { PendingPayment } from "./src/components/pending-payment";
      import { CustomerCpfField } from "./src/components/customer-cpf-field";
      createRoot(document.getElementById("root")).render(location.pathname === "/cpf"
        ? <div className="checkout-page container page-shell"><form className="checkout-form"><div className="field"><label htmlFor="name">Nome</label><input id="name" value="Cliente Teste" readOnly /></div><div className="field"><CustomerCpfField lastFour="9608" /></div></form></div>
        : <PendingPayment orderId="isolated-order" />);
    ` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-dependencies", setup(build) {
      build.onResolve({ filter: /^(next\/(image|link)|@\/components\/cart-provider)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: resolve("apps/store"), contents:
        args.path.includes("cart-provider") ? "const removeMany = () => {}; export const useCart = () => ({removeMany});"
          : args.path.endsWith("image") ? 'import React from "react"; export default function Image({unoptimized,...props}) {return <img {...props}/>;}'
            : 'import React from "react"; export default function Link(props) {return <a {...props}/>;}' }));
    } }]
  });
  const css = readFileSync("apps/store/src/app/globals.css", "utf8").replace('@import "tailwindcss";', "");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const screenshots = mkdtempSync(join(tmpdir(), "curtiz-payment-"));
  try {
    const page = await browser.newPage();
    let state = { orderCode: "CZT-12345", orderStatus: "pending_payment", status: "pending", method: "pix", amountInCents: 6790,
      expiresAt: new Date(Date.now() + 27 * 60_000).toISOString(), pixCopyPaste: "isolated-pix-code",
      pixQrCodeBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", variantIds: [], boletoUrl: "", digitableLine: "" };
    let cpfRequests = 0, failCpf = false;
    await page.route("https://payment.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
      if (path.startsWith("/api/orders/")) return route.fulfill({ status: state.status === "pending" ? 200 : 409, json: state });
      if (path === "/api/customer/cpf") {
        cpfRequests++;
        assert.equal(route.request().postDataJSON().cpf, "52998224725");
        return route.fulfill({ status: failCpf ? 503 : 200, json: failCpf ? { ok: false } : { ok: true, cpfLastFour: "4725" } });
      }
      return route.fulfill({ contentType: "text/html", body: `<html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-manrope:Arial}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button,input{font:inherit}${css}</style><div id="root"></div><script src="/app.js"></script></html>` });
    });
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto("https://payment.test/payment");
      await page.getByRole("button", { name: "Copiar código Pix", exact: true }).waitFor();
      assert.equal(await page.getByRole("img", { name: "QR Code Pix deste pedido" }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      const markers = await page.locator(".order-progress-marker").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert.ok(markers.every(top => Math.abs(top - markers[0]) < 1));
      if ([360, 1280].includes(width)) await page.screenshot({ path: join(screenshots, `payment-${width}.png`), fullPage: true });
    }
    await page.reload();
    await page.getByRole("button", { name: "Copiar código Pix", exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".order-progress .active").evaluate(node => getComputedStyle(node, "::after").animationName), "none");
    for (const [orderStatus, completed] of [["payment_approved", 2], ["processing", 2], ["picking", 2], ["ready_to_ship", 2], ["shipped", 4], ["delivered", 5]]) {
      state = { ...state, orderStatus, status: "approved" };
      await page.reload();
      await page.getByRole("heading", { name: "Pagamento confirmado" }).waitFor();
      assert.equal(await page.locator(".order-progress .complete").count(), completed);
      assert.equal(await page.getByRole("button", { name: "Copiar código Pix", exact: true }).count(), 0);
      assert.equal(await page.getByRole("img", { name: "QR Code Pix deste pedido" }).count(), 0);
      assert.equal(await page.locator(".order-progress .active").count(), completed === 5 ? 0 : 1);
    }
    for (const status of ["expired", "cancelled", "rejected", "refunded", "charged_back", "unavailable"]) {
      state = { ...state, status, orderStatus: "cancelled" };
      await page.reload();
      await page.getByRole("complementary", { name: "Resumo do pedido" }).waitFor();
      assert.equal(await page.locator(".order-progress").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Copiar código Pix", exact: true }).count(), 0);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("https://payment.test/cpf");
    const cpf = page.getByLabel("CPF", { exact: true });
    await cpf.waitFor();
    const dimensions = await page.locator("input").evaluateAll(nodes => nodes.map(node => ({ height: node.offsetHeight, width: node.offsetWidth })));
    assert.deepEqual(dimensions[0], dimensions[1]);
    await page.getByRole("button", { name: "Alterar CPF" }).click();
    assert.equal(await cpf.inputValue(), "");
    assert.equal(await cpf.evaluate(node => node === document.activeElement), true);
    assert.equal(await page.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true);
    await cpf.fill("11111111111");
    assert.equal(await page.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(cpfRequests, 0);
    assert.equal(await cpf.inputValue(), "•••.•••.•••-9608");
    assert.equal(await page.getByRole("button", { name: "Alterar CPF" }).evaluate(node => node === document.activeElement), true);
    await page.getByRole("button", { name: "Alterar CPF" }).click();
    await cpf.fill("52998224725"); failCpf = true;
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByText("Não foi possível salvar o CPF. Tente novamente.", { exact: true }).waitFor();
    assert.equal(await cpf.inputValue(), "529.982.247-25");
    failCpf = false;
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByRole("button", { name: "Alterar CPF" }).waitFor();
    assert.equal(await cpf.inputValue(), "•••.•••.•••-4725");
    assert.equal(cpfRequests, 2);
    await page.screenshot({ path: join(screenshots, "cpf-360.png"), fullPage: true });
    console.info(`Payment/CPF browser regressions passed. Screenshots: ${screenshots}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
