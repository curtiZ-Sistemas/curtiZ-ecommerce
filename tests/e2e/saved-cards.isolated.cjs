// Real React Bricks, mocked official SDK and API transport. No real card or payment.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
(async () => {
  const built = await esbuild.build({ stdin: { resolveDir: resolve("apps/store"), loader: "tsx", contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { MercadoPagoPaymentBrick } from "./src/components/mercadopago-payment-brick";
    window.__probe = { completions: [], unmounts: 0, settings: {} };
    window.MercadoPago = class { bricks() { return { create: async (type, container, settings) => {
      window.__probe.settings[type] = settings;
      settings.callbacks.onReady(); return { unmount() { window.__probe.unmounts++; } };
    } }; } };
    const checkout = { customer: { name: "Cliente", email: "test_payer_1@testuser.com", phone: "11999999999", cpf: "52998224725" }, address: {}, lines: [] };
    const session = { orderId: "", orderCode: "", amountInCents: 6790, publicKey: "TEST-public", paymentMode: "test",
      idempotencyKey: "22222222-2222-4222-8222-222222222222", email: checkout.customer.email, cpf: checkout.customer.cpf, checkout };
    createRoot(document.getElementById("root")).render(<MercadoPagoPaymentBrick session={session}
      onBack={() => window.__probe.back = true} onComplete={(...result) => window.__probe.completions.push(result)} />);
  ` }, bundle: true, write: false, platform: "browser", jsx: "automatic", alias: { "@": resolve("apps/store/src") },
    plugins: [{ name: "script-fixture", setup(build) {
      build.onResolve({ filter: /^next\/script$/ }, () => ({ path: "script", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "jsx", contents: "export default function Script(){return null}" }));
    } }], define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    let paymentRequests = [], saveRequests = [], paymentStatus = "approved", paymentRelease;
    let delayPayment = false;
    const page = await browser.newPage();
    const orderId = "11111111-1111-4111-8111-111111111111";
    await page.route("https://cards.test/**", route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/api/customer/cards") {
        if (request.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, enabled: true, customerId: "customer-1", cards: [{ id: "card-1" }] }) });
        saveRequests.push(request.postDataJSON());
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"code":"SAVED_CARDS_UNAVAILABLE"}' });
      }
      if (path === "/api/checkout/payment") {
        paymentRequests.push(request.postDataJSON());
        const fulfill = () => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: paymentStatus, orderId, orderCode: "CZ-123" }) });
        return delayPayment ? new Promise(resolve => { paymentRelease = () => resolve(fulfill()); }) : fulfill();
      }
      if (path.startsWith("/pedido/")) return route.fulfill({ contentType: "text/html", body: "Acompanhamento do pedido" });
      return route.fulfill({ contentType: "text/html", body: '<script nonce="request-nonce"></script><div id="root"></div><script src="/app.js"></script>' });
    });
    const open = async () => {
      paymentRequests = []; saveRequests = [];
      await page.goto("https://cards.test/checkout");
      await page.waitForFunction(() => window.__probe.settings.payment);
    };
    const cardData = { payment_method_id: "visa", token: "payment-only-token", payer: { identification: { type: "CPF", number: "12345678909" } } };
    const cardSubmit = () => page.evaluate(async data => {
      await window.__probe.settings.payment.callbacks.onSubmit({ selectedPaymentMethod: "credit_card", formData: data });
    }, cardData);
    await open();
    assert.deepEqual(await page.evaluate(() => window.__probe.settings.payment.initialization.payer.cardsIds), ["card-1"]);
    let submit = cardSubmit();
    const checkbox = page.getByRole("checkbox", { name: "Salvar este cartão para próximas compras" });
    await checkbox.waitFor(); assert.equal(await checkbox.isChecked(), false);
    await page.getByRole("button", { name: "Confirmar pagamento" }).click(); await submit;
    assert.equal(saveRequests.length, 0, "Unchecked consent never saves");
    assert.equal(await page.evaluate(() => window.__probe.completions[0][0]), "approved");

    await open(); submit = cardSubmit();
    await checkbox.waitFor(); await checkbox.check();
    await page.getByRole("button", { name: "Confirmar pagamento" }).click(); await submit;
    await page.waitForFunction(() => window.__probe.settings.cardPayment);
    assert.equal(paymentRequests.length, 1); assert.equal(await page.evaluate(() => window.__probe.unmounts), 1);
    assert.equal(await page.evaluate(() => window.__probe.completions.length), 0);
    await page.evaluate(async () => { await window.__probe.settings.cardPayment.callbacks.onSubmit({ token: "fresh-save-only-token" }); });
    assert.equal(saveRequests.length, 1); assert.equal(saveRequests[0].token, "fresh-save-only-token");
    assert.notEqual(saveRequests[0].token, paymentRequests[0].payment.token);
    await page.getByText("Sua compra está aprovada, mas não foi possível confirmar o salvamento do cartão.").waitFor();
    const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    assert.equal(storage.includes("payment-only-token") || storage.includes("fresh-save-only-token"), false);
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__probe.completions[0][0]), "approved");
    assert.equal(paymentRequests.length, 1, "Save failure cannot create another charge");

    await open(); paymentStatus = "pending"; delayPayment = true;
    const hit = page.waitForRequest("**/api/checkout/payment");
    submit = page.evaluate(async () => { await window.__probe.settings.payment.callbacks.onSubmit({ selectedPaymentMethod: "bank_transfer", formData: { payment_method_id: "pix" } }); });
    await hit; assert.equal(await checkbox.count(), 0, "Pix never shows card consent");
    assert.equal(await page.getByRole("button", { name: "Voltar", exact: true }).isDisabled(), true);
    paymentRelease(); await submit;
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await page.waitForURL(`**/pedido/${orderId}/pagamento`);
    assert.equal(paymentRequests.length, 1, "Pending payment Back only opens tracking");
    console.log(JSON.stringify({ result: "PASS", officialSavedCardsInitialization: true, uncheckedDoesNotSave: true,
      freshSaveToken: true, saveFailurePreservesApproval: true, tokensNotPersisted: true,
      pixNoConsent: true, backDisabledDuringPayment: true, approvedBackPreservesApproval: true, pendingBackTracksExistingOrder: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
