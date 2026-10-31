// Isolated browser regression: real component lifecycle with a mocked Mercado Pago SDK.
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
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
        window.__probe = { creates: 0, unmounts: 0, ready: 0, completions: [], reviews: [] };
        window.MercadoPago = class {
          constructor(publicKey, options) { window.__probe.publicKey = publicKey; window.__probe.options = options; }
          bricks() { return { create: async (_type, container, settings) => {
            window.__probe.creates += 1;
            window.__probe.container = container;
            window.__probe.settings = settings;
            window.__probe.clicksCompleted = 0;
            const pay = document.createElement("button");
            pay.textContent = "Pagar";
            pay.addEventListener("click", async () => {
              try { await settings.callbacks.onSubmit({ formData: window.__probe.formData }); }
              catch (error) { window.__probe.clickError = error.message; }
              finally { window.__probe.clicksCompleted += 1; }
            });
            document.getElementById(container).appendChild(pay);
            settings.callbacks.onReady();
            return { unmount: () => { window.__probe.unmounts += 1; } };
          } }; }
        };
        const key = "22222222-2222-4222-8222-222222222222";
        sessionStorage.setItem("curtiz-checkout-idempotency", key);
        const checkout = {
          customer: { name: "Cliente Teste", email: "cliente@example.com", phone: "11999999999", cpf: "52998224725" },
          address: { postalCode: "01310100", street: "Av Paulista", number: "1", complement: "", district: "Bela Vista", city: "Sao Paulo", state: "SP" },
          lines: [{ productId: "33333333-3333-4333-8333-333333333333", variantId: "44444444-4444-4444-8444-444444444444", color: "Preto", size: "39", quantity: 1 }]
        };
        const session = { orderId: "", orderCode: "", subtotalInCents: 5100, shippingInCents: 1690, amountInCents: 6790, publicKey: "TEST-public-key", idempotencyKey: key, email: "cliente@example.com", cpf: "52998224725", paymentMode: "test", checkout };
        window.__root = createRoot(document.getElementById("root"));
        window.__root.render(<MercadoPagoPaymentBrick session={session}
          onComplete={(...args) => window.__probe.completions.push(args)}
          onReviewCheckout={message => window.__probe.reviews.push(message)} />);
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
    const requests = [], responses = [];
    await page.route("https://brick.test/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (pathname === "/api/checkout/payment") {
        assert.equal(route.request().method(), "POST");
        requests.push(route.request().postDataJSON());
        const next = responses.shift();
        if (typeof next === "function") return next(route);
        if (!next) throw new Error("Unexpected payment request");
        return route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify(next.body) });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<script nonce="request-nonce"></script><div id="root"></div><script src="/app.js"></script>'
      });
    });
    await page.goto("https://brick.test/");
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
    assert.equal(probe.settings.initialization.payer.identification, undefined);
    const key = "22222222-2222-4222-8222-222222222222";
    const orderId = "11111111-1111-4111-8111-111111111111";
    const formData = { payment_method_id: "visa", token: "token-one", installments: 1,
      payer: { identification: { type: "CPF", number: "12345678909" } } };
    const submit = data => page.evaluate(async value => {
      try { await window.__probe.settings.callbacks.onSubmit({ formData: value }); return "resolved"; }
      catch (error) { return error.message; }
    }, data);

    await submit({ ...formData, payer: { identification: { type: "CPF", number: "11111111111" } } });
    assert.equal(requests.length, 0, "Invalid local document must not submit");

    const clickCases = [
      { data: { payment_method_id: "pix" }, document: "52998224725" },
      { data: { payment_method_id: "pix", payer: { identification: { number: "12345678900" } } }, document: "12345678900" },
      { data: { payment_method_id: "visa", token: "card-token", issuer_id: 25, installments: 2 }, document: "52998224725" },
      { data: { payment_method_id: "bolbradesco", payer: { email: "cliente@example.com", identification: {} } }, document: "52998224725" }
    ];
    for (const [index, scenario] of clickCases.entries()) {
      responses.push({ status: 200, body: { ok: true, status: "rejected", recovery: "new_attempt", message: "Recusa simulada para testar nova tentativa." } });
      await page.evaluate(data => { window.__probe.formData = data; }, scenario.data);
      const post = page.waitForRequest("**/api/checkout/payment");
      await page.getByRole("button", { name: "Pagar", exact: true }).click();
      await post;
      await page.waitForFunction(count => window.__probe.clicksCompleted === count, index + 1);
      assert.equal(requests[index].payment.payment_method_id, scenario.data.payment_method_id);
      assert.equal(requests[index].payment.payer.identification.number, scenario.document);
      assert.equal(requests[index].checkout.customer.cpf, "52998224725", "Provider document must not overwrite checkout identity");
      if (scenario.data.token) assert.equal(requests[index].payment.token, scenario.data.token);
    }
    requests.length = 0;
    responses.push({ status: 400, body: { ok: false, code: "INVALID_PAYER_DOCUMENT", recovery: "new_attempt", message: "Revise o CPF de teste." } });
    assert.equal(await submit(formData), "payment_not_completed");
    assert.equal(requests[0].checkout.customer.cpf, "52998224725");
    assert.equal(requests[0].payment.payer.identification.number, "12345678909");
    assert.notEqual(requests[0].idempotencyKey, key);

    responses.push({ status: 200, body: { ok: true, status: "rejected", recovery: "new_attempt", orderId, orderCode: "CZ-123", message: "Pagamento recusado." } });
    await submit({ ...formData, token: "token-two" });
    assert.notEqual(requests[1].idempotencyKey, requests[0].idempotencyKey, "HTTP 400 must permit a fresh attempt");
    assert.equal(requests[1].checkoutIdempotencyKey, key);
    assert.equal(await page.evaluate(() => window.__probe.completions.length), 0);

    responses.push({ status: 502, body: { ok: false, code: "PAYMENT_RESULT_UNCERTAIN", recovery: "retry_attempt", orderId, message: "Verifique a mesma tentativa." } });
    await submit({ ...formData, token: "token-three" });
    assert.notEqual(requests[2].idempotencyKey, requests[1].idempotencyKey, "Rejected payment must permit a fresh attempt");
    assert.equal(requests[2].orderId, orderId);
    assert.equal(requests[2].checkout, undefined, "Retry must use the existing order");
    responses.push({ status: 200, body: { ok: true, status: "rejected", recovery: "new_attempt", orderId, message: "Pagamento recusado." } });
    await submit({ ...formData, token: "new-token-must-not-replace-uncertain-token" });
    assert.deepEqual(requests[3], requests[2], "Uncertain HTTP retry must keep the complete original body");

    let release;
    responses.push(route => new Promise(resolve => {
      release = () => resolve(route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, status: "rejected", recovery: "new_attempt", orderId, message: "Pagamento recusado." }) }));
    }));
    const hit = page.waitForRequest("**/api/checkout/payment");
    const doubleSubmit = page.evaluate(async data => {
      const callback = window.__probe.settings.callbacks.onSubmit;
      return Promise.allSettled([callback({ formData: data }), callback({ formData: data })]);
    }, { ...formData, token: "token-four" });
    await hit;
    await page.waitForFunction(() => document.getElementById("mercadopago-payment-brick").inert);
    assert.equal(requests.length, 5, "Concurrent onSubmit must send only one request");
    release();
    const outcomes = await doubleSubmit;
    assert.equal(outcomes.filter(outcome => outcome.status === "rejected").length, 2);
    await page.waitForFunction(() => !document.getElementById("mercadopago-payment-brick").inert);

    responses.push({ status: 409, body: { ok: false, code: "CHECKOUT_CHANGED", recovery: "review_checkout", message: "A quantidade disponível mudou." } });
    await submit(formData);
    await page.getByRole("alert").filter({ hasText: "A quantidade disponível mudou." }).waitFor();
    await page.getByRole("button", { name: "Revisar checkout" }).click();
    assert.deepEqual(await page.evaluate(() => window.__probe.reviews), ["A quantidade disponível mudou."]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("curtiz-checkout-idempotency")), key);

    responses.push({ status: 409, body: { ok: false, code: "PAYMENT_ATTEMPT_CONFLICT", recovery: "view_order", orderId, message: "Tentativa vinculada a outros dados." } });
    await submit(formData);
    await page.getByRole("link", { name: "Acompanhar pagamento do pedido" }).waitFor();
    assert.equal(await page.evaluate(() => window.__probe.completions.length), 0, "Recoverable conflict must not redirect automatically");
    responses.push({ status: 200, body: { ok: true, status: "pending", orderId, orderCode: "CZ-123" } });
    assert.equal(await submit(formData), "resolved");
    assert.deepEqual(await page.evaluate(() => window.__probe.completions), [["pending", "CZ-123", orderId]]);
    await page.evaluate(() => window.__root.unmount());
    await page.waitForFunction(() => window.__probe?.unmounts === 1);
    console.log(JSON.stringify({ result: "PASS", amount: probe.amount, nonceForwarded: true, creates: probe.creates,
      retryAfter400: true, retryAfterRejected: true, concurrentSubmitBlocked: true, uncertainRetryPreserved: true,
      logicalCheckoutKeyPreserved: true, conflictsExplained: true, realCpfPreserved: true,
      payClickReachedPost: true, pixFallback: true, pixProviderDocument: true, cardFallback: true, boletoFallback: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
