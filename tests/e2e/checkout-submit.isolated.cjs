// Real checkout form with isolated cart, profile and preparation responses.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { chromium } = require("@playwright/test");
const esbuild = createRequire(require.resolve("tsx"))("esbuild");

(async () => {
  const built = await esbuild.build({
    stdin: {
      resolveDir: resolve("apps/store"),
      loader: "tsx",
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
        window.__brickUnmounts = 0;
        window.MercadoPago = class {
          bricks() { return { create: async (type, container, settings) => {
            window.__brickCreates++; window.__brickCallbacks = settings.callbacks;
            settings.callbacks.onReady(); return { unmount() { window.__brickUnmounts++; } };
          } }; }
        };
        createRoot(document.getElementById("root")).render(<CheckoutPage />);
      `
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    alias: { "@": resolve("apps/store/src") },
    plugins: [
      {
        name: "checkout-fixtures",
        setup(build) {
          const fixtures = {
            "next/link": "export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
            "next/image":
              "export default function Image({src,alt,width,height}){return <img src={src} alt={alt} width={width} height={height} />}",
            "next/script": "export default function Script(){return null}",
            "next/navigation": "export const useRouter=()=>window.__router;",
            "cart-provider": "export const useCart=()=>window.__cart;",
            "intelligence-client": "export function trackIntelligence(){}"
          };
          build.onResolve(
            {
              filter: /^(next\/(link|image|script|navigation))$|cart-provider$|intelligence-client$/
            },
            (args) => {
              const path = args.path.startsWith("next/") ? args.path : args.path.split("/").pop();
              return { path, namespace: "fixture" };
            }
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "jsx",
            contents: fixtures[args.path],
            resolveDir: resolve("apps/store")
          }));
        }
      }
    ],
    define: { "process.env.NODE_ENV": '"production"' }
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    let profileRelease, prepareRelease, shippingRelease;
    const requests = [];
    const addressSaves = [];
    let shippingCalls = 0;
    let generatedAddressCount = 0;
    const address = {
      id: "77777777-7777-4777-8777-777777777777",
      label: "Casa",
      postalCode: "01310100",
      street: "Av Paulista",
      number: "1",
      complement: "",
      district: "Bela Vista",
      city: "Sao Paulo",
      state: "SP",
      recipientName: "Cliente Teste",
      isDefault: true
    };
    const secondAddress = {
      ...address,
      id: "88888888-8888-4888-8888-888888888888",
      label: "Casa 2",
      number: "1000",
      complement: "Apartamento 102",
      recipientName: "Cliente Teste",
      isDefault: false
    };
    const thirdAddress = {
      ...address,
      id: "99999999-9999-4999-8999-999999999999",
      label: "Trabalho",
      number: "300",
      isDefault: false
    };
    let addresses = [address, secondAddress, thirdAddress],
      profileLoaded = false;
    const css = readFileSync(resolve("apps/store/src/app/globals.css"), "utf8").replace('@import "tailwindcss";', "");
    await page.route("https://checkout.test/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      if (path === "/styles.css") return route.fulfill({ contentType: "text/css", body: css });
      if (path === "/api/checkout/profile")
        return new Promise((resolve) => {
          const release = () =>
            resolve(
              route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                  profile: {
                    fullName: "Cliente Teste",
                    email: "cliente@example.com",
                    phone: "11999999999",
                    cpfConfigured: true,
                    cpfLastFour: "4725"
                  },
                  addresses
                })
              })
            );
          if (profileLoaded) release();
          else {
            profileLoaded = true;
            profileRelease = release;
          }
        });
      if (path === "/api/customer/cards")
        return route.fulfill({
          contentType: "application/json",
          body: '{"ok":true,"enabled":false,"cards":[]}'
        });
      if (path === "/api/customer/cpf")
        return route.fulfill({
          contentType: "application/json",
          body: '{"ok":true,"cpfLastFour":"0909"}'
        });
      if (path === "/api/customer") {
        const body = route.request().postDataJSON();
        if (body.action === "address_delete") {
          addresses = addresses.filter((address) => address.id !== body.id);
          return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
        }
        assert.equal(body.action, "address_save");
        addressSaves.push(body);
        const existing = body.id ? addresses.find((address) => address.id === body.id) : null;
        const savedId =
          existing?.id ?? (generatedAddressCount++ === 0 ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        let label = body.label;
        if (!existing && ["Casa", "Trabalho"].includes(label)) {
          const labels = addresses
            .filter((address) => address.label === label || address.label.startsWith(`${label} `))
            .map((address) => {
              const suffix = Number(address.label.slice(label.length).trim());
              return Number.isInteger(suffix) && suffix > 0 ? suffix : address.label === label ? 1 : 0;
            });
          const suffix = Math.max(0, ...labels) + 1;
          label = suffix === 1 ? label : `${label} ${suffix}`;
        }
        const saved = {
          id: savedId,
          label,
          postalCode: body.postalCode.replace(/\D/g, ""),
          street: body.street,
          number: body.number,
          complement: body.complement,
          district: body.district,
          city: body.city,
          state: body.state.toUpperCase(),
          recipientName: body.recipientName,
          isDefault: body.isDefault || addresses.length === 0
        };
        if (saved.isDefault) addresses = addresses.map((address) => ({ ...address, isDefault: false }));
        addresses = [saved, ...addresses.filter((address) => address.id !== savedId)];
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: savedId,
            address: {
              id: saved.id,
              label: saved.label,
              recipient_name: saved.recipientName,
              postal_code: saved.postalCode,
              street: saved.street,
              number: saved.number,
              complement: saved.complement,
              district: saved.district,
              city: saved.city,
              state: saved.state,
              is_default: saved.isDefault
            }
          })
        });
      }
      if (path === "/api/shipping/quote") {
        shippingCalls++;
        if (shippingCalls === 1)
          return new Promise((resolve) => {
            shippingRelease = () =>
              resolve(
                route.fulfill({
                  status: 503,
                  contentType: "application/json",
                  body: JSON.stringify({
                    ok: false,
                    message: "Não foi possível calcular o frete agora. Tente novamente."
                  })
                })
              );
          });
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            quotes: [
              {
                id: "quote-standard",
                service: "Entrega padrão",
                carrier: "Transportadora A",
                amountInCents: 1690,
                estimatedDays: 5,
                expiresAt: null
              },
              {
                id: "quote-express",
                service: "Entrega expressa",
                carrier: "Transportadora B",
                amountInCents: 2490,
                estimatedDays: 2,
                expiresAt: null
              }
            ]
          })
        });
      }
      if (path === "/api/checkout/coupon")
        return route.fulfill({
          contentType: "application/json",
          body: '{"ok":true,"discountInCents":500,"name":"Boas-vindas"}'
        });
      if (path === "/api/checkout") {
        requests.push(route.request().postDataJSON());
        return new Promise((resolve) => {
          prepareRelease = (status, body) =>
            resolve(route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
        });
      }
      if (path === "/api/checkout/payment")
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            code: "CUSTOMER_IDENTITY_REQUIRED",
            recovery: "review_checkout",
            message: "Informe e salve o CPF do cliente no checkout."
          })
        });
      if (path.startsWith("/api/")) throw new Error(`Unexpected checkout request: ${path}`);
      return route.fulfill({
        contentType: "text/html",
        body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><script nonce="request-nonce"></script><div id="root"></div><script src="/app.js"></script>'
      });
    });
    const profileHit = page.waitForRequest("**/api/checkout/profile");
    await page.goto("https://checkout.test/checkout");
    await profileHit;
    const button = page.getByRole("button", { name: "Continuar para pagamento" });
    assert.equal(await button.isDisabled(), true);
    profileRelease();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.locator('input[name="cpf"]').getAttribute("type"), "hidden");
    const addAddressButton = page.getByRole("button", { name: "Adicionar endereço", exact: true });
    assert.equal(await addAddressButton.count(), 0, "Three addresses enforce the existing limit");
    await page.locator(`input[value="${secondAddress.id}"]`).check();
    const expand = page.getByRole("button", { name: "Expandir endereço Casa 2" });
    const detailsId = await expand.getAttribute("aria-controls");
    assert.equal(await expand.getAttribute("aria-expanded"), "false");
    await expand.click();
    assert.equal(await page.getByRole("button", { name: "Recolher endereço Casa 2" }).getAttribute("aria-expanded"), "true");
    await page.locator(`#${detailsId}`).getByText("Apartamento 102", { exact: false }).waitFor();
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Checkout overflow at ${width}px`);
      assert.equal(
        await page
          .locator(`#${detailsId}`)
          .evaluate((element) => getComputedStyle(element).transitionProperty.includes("grid-template-rows")),
        true
      );
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: resolve(tmpdir(), "curtiz-checkout-address-mobile.png"),
      fullPage: true
    });
    const secondDetails = page.locator(`#${detailsId}`);
    const secondCard = page.locator(".checkout-address-card").filter({ has: page.locator(`#checkout-address-select-${secondAddress.id}`) });
    await secondDetails.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByRole("heading", { name: "Editar endereço" }).waitFor();
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `Address editor overflow at ${width}px`
      );
    }
    await page.setViewportSize({ width: 390, height: 900 });
    for (const action of await page.getByRole("button", { name: /Salvar endereço|Cancelar/ }).all()) {
      assert.ok(
        await action.evaluate((element) => element.getBoundingClientRect().height >= 44),
        "Address actions remain easy to tap on mobile"
      );
    }
    assert.equal(await page.locator('input[name="number"]').inputValue(), "1000");
    assert.equal(await page.locator('input[name="recipientName"]').inputValue(), "Cliente Teste");
    await page.locator('input[name="number"]').fill("1999");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(addressSaves.length, 0, "Canceling an edit must not persist the draft");
    assert.equal(await page.locator(`input[value="${secondAddress.id}"]`).isChecked(), true);
    assert.equal(await secondCard.getByText("Av Paulista, 1000", { exact: true }).count(), 1, "Cancel restores the selected saved address");
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
      "Editar",
      "Cancel returns focus to the action that opened the editor"
    );

    await page.locator('input[name="couponCode"]').fill("BEMVINDO");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await page.getByText("Cupom Boas-vindas").waitFor();
    await page.getByRole("button", { name: "Expandir endereço Casa" }).click();
    const firstAddressDetails = page.locator(`#checkout-address-${address.id}`);
    await firstAddressDetails.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('input[name="number"]').fill("1999");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(
      await page.locator(`#checkout-address-select-${secondAddress.id}`).isChecked(),
      true,
      "Canceling an unselected address edit preserves the checkout selection"
    );
    assert.equal(await page.locator('input[name="couponCode"]').inputValue(), "BEMVINDO", "Canceling an address edit preserves the coupon");
    assert.equal(addressSaves.length, 0);

    await page.getByRole("button", { name: "Expandir endereço Casa 2" }).click();
    await secondDetails.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('input[name="number"]').fill("1001");
    await page.locator('input[name="isDefault"]').check();
    const editSaveHit = page.waitForRequest("**/api/customer");
    await page.getByRole("button", { name: "Salvar endereço", exact: true }).click();
    const editSaveRequest = await editSaveHit;
    assert.equal(editSaveRequest.postDataJSON().action, "address_save");
    assert.equal(editSaveRequest.postDataJSON().id, secondAddress.id);
    assert.equal(addressSaves.length, 1, "Explicit edit save sends exactly one address_save request");
    assert.equal(addressSaves[0].number, "1001");
    assert.equal(addressSaves[0].isDefault, true);
    await page.locator('input[name="number"]:not([type="hidden"])').waitFor({ state: "detached" });
    assert.equal(await page.locator(`#checkout-address-select-${secondAddress.id}`).isChecked(), true, "Saved address stays selected");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      `checkout-address-select-${secondAddress.id}`,
      "Save moves focus to the selected saved address"
    );
    assert.equal(await secondCard.getByText("Av Paulista, 1001", { exact: true }).count(), 1);
    await page.getByRole("status").filter({ hasText: "Endereço salvo." }).waitFor();

    await page.locator(`input[value="${thirdAddress.id}"]`).check();
    await page.getByRole("button", { name: "Expandir endereço Trabalho" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`#checkout-address-${thirdAddress.id}`).getByRole("button", { name: "Excluir", exact: true }).click();
    await addAddressButton.waitFor();
    assert.equal(await page.locator(`input[value="${thirdAddress.id}"]`).count(), 0);
    await addAddressButton.click();
    await page.getByRole("heading", { name: "Novo endereço" }).waitFor();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(addressSaves.length, 1, "Canceling a new address must not create a record");
    await addAddressButton.click();
    await page.locator('input[name="street"]').waitFor();
    await page.getByRole("button", { name: "Salvar endereço", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Informe um CEP válido." }).waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("name")),
      "postalCode",
      "Invalid save focuses the first invalid field"
    );
    await page.locator('input[name="postalCode"]').fill("01310100");
    await page.locator('input[name="street"]').fill("Av Paulista");
    await page.locator('input[name="number"]').fill("1");
    await page.locator('input[name="district"]').fill("Bela Vista");
    await page.locator('input[name="city"]').fill("Sao Paulo");
    await page.locator('select[name="state"]').selectOption("SP");
    await page.getByRole("button", { name: "Salvar endereço", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Este endereço já está cadastrado." }).waitFor();
    assert.equal(addressSaves.length, 1, "Duplicate address is rejected before persistence");
    await page.locator('input[name="number"]').fill("25");
    const newSaveHit = page.waitForRequest("**/api/customer");
    await page.getByRole("button", { name: "Salvar endereço", exact: true }).click();
    const newSaveRequest = await newSaveHit;
    assert.equal(newSaveRequest.postDataJSON().action, "address_save");
    assert.equal(newSaveRequest.postDataJSON().id, null);
    assert.equal(addressSaves.length, 2, "New address is explicitly persisted once");
    assert.equal(await page.locator('input[value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]').isChecked(), true);
    assert.equal(
      await page.getByRole("button", { name: "Adicionar endereço", exact: true }).count(),
      0,
      "Three addresses still enforce the limit"
    );

    const savedAddressFixtures = [...addresses];
    addresses = [];
    const emptyProfileHit = page.waitForRequest("**/api/checkout/profile");
    await page.reload();
    await emptyProfileHit;
    await page.getByText("Nenhum endereço cadastrado.", { exact: true }).waitFor();
    assert.equal(await button.isDisabled(), true, "Checkout cannot continue without a saved address");
    assert.equal(await page.getByRole("button", { name: "Calcular frete", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click();
    await page.getByRole("heading", { name: "Novo endereço" }).waitFor();
    await page.getByText("Salve ou cancele para continuar.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(addressSaves.length, 2, "Canceling the first address leaves no record");
    assert.equal(await button.isDisabled(), true);
    await page.getByRole("button", { name: "Adicionar endereço", exact: true }).click();
    await page.locator('input[name="postalCode"]').fill("04538000");
    await page.locator('input[name="street"]').fill("Rua de Teste");
    await page.locator('input[name="number"]').fill("10");
    await page.locator('input[name="district"]').fill("Itaim");
    await page.locator('input[name="city"]').fill("Sao Paulo");
    await page.locator('select[name="state"]').selectOption("SP");
    const firstAddressSaveHit = page.waitForRequest("**/api/customer");
    await page.getByRole("button", { name: "Salvar endereço", exact: true }).click();
    await firstAddressSaveHit;
    assert.equal(addressSaves.length, 3);
    assert.equal(addressSaves[2].isDefault, true, "The first saved address remains the default");
    assert.equal(addresses.length, 1);
    await page.getByRole("status").filter({ hasText: "Endereço salvo." }).waitFor();
    assert.equal(await page.locator('input[name="selectedAddress"]').isChecked(), true);

    addresses = savedAddressFixtures;
    const restoredProfileHit = page.waitForRequest("**/api/checkout/profile");
    await page.reload();
    await restoredProfileHit;
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.getByRole("button", { name: "Adicionar endereço", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Expandir endereço Casa 2" }).click();

    const calculateShipping = page.getByRole("button", { name: "Calcular frete", exact: true });
    const shippingButtonRect = await calculateShipping.evaluate((element) => element.getBoundingClientRect().toJSON());
    const shippingSectionRect = await page
      .locator("#checkout-delivery-title")
      .evaluate((element) => element.parentElement.getBoundingClientRect().toJSON());
    assert.ok(shippingButtonRect.height >= 48, "Calculate shipping has a comfortable touch target");
    assert.ok(shippingButtonRect.width >= shippingSectionRect.width - 40, "Calculate shipping fills the mobile section");
    await calculateShipping.click();
    await page.getByRole("button", { name: "Calculando..." }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Calculando..." }).getAttribute("aria-busy"), "true");
    shippingRelease();
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).waitFor();
    await page.getByRole("alert").filter({ hasText: "Não foi possível calcular o frete" }).waitFor();
    const retryShipping = page.waitForRequest("**/api/shipping/quote");
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await retryShipping;
    const expressQuote = page.locator('input[name="shippingQuote"][value="quote-express"]');
    await expressQuote.waitFor();
    await expressQuote.check();
    assert.equal(await expressQuote.isChecked(), true, "Shipping options stay selectable as complete rows");
    assert.equal(await page.getByRole("button", { name: "Recalcular frete", exact: true }).count(), 1);
    await page.locator("#checkout-address-select-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").check();
    assert.equal(await page.locator('input[name="shippingQuote"]').count(), 0, "Selecting another address invalidates old quotes");
    await page.locator(`#checkout-address-select-${secondAddress.id}`).check();
    const secondShipping = page.waitForRequest("**/api/shipping/quote");
    await page.getByRole("button", { name: "Calcular frete", exact: true }).click();
    await secondShipping;
    await page.locator('input[name="shippingQuote"][value="quote-standard"]').check();

    await secondDetails.getByRole("button", { name: "Editar", exact: true }).click();
    await page.locator('input[name="postalCode"]').fill("02222000");
    assert.equal(await page.locator('input[name="shippingQuote"]').count(), 0, "Changing the editor CEP invalidates an old quote");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.locator(`#checkout-address-select-${secondAddress.id}`).isChecked(), true);
    assert.equal(await page.locator('input[name="postalCode"][type="hidden"]').inputValue(), "01310100");
    const thirdShipping = page.waitForRequest("**/api/shipping/quote");
    await page.getByRole("button", { name: "Calcular frete", exact: true }).click();
    await thirdShipping;
    await page.locator('input[name="shippingQuote"][value="quote-standard"]').check();
    await secondDetails.getByRole("button", { name: "Editar", exact: true }).click();
    const checkoutRequestsBeforeEditorGuard = requests.length;
    await button.click();
    await page.getByRole("alert").filter({ hasText: "Salve ou cancele o endereço antes de continuar." }).waitFor();
    assert.equal(requests.length, checkoutRequestsBeforeEditorGuard, "Open editor cannot start payment preparation");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "checkout-address-save");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();

    await page.locator('input[name="couponCode"]').fill("BEMVINDO");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await page.getByText("Cupom Boas-vindas").waitFor();

    const firstHit = page.waitForRequest("**/api/checkout");
    await page.locator("form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await firstHit;
    assert.equal(requests.length, 1, "Two synchronous form submissions must prepare only one checkout");
    assert.equal(addressSaves.length, 3, "Continuing checkout must not save an address again");
    assert.match(
      requests[0].idempotencyKey,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "Corrupt stored logical keys must be replaced before preparation"
    );
    prepareRelease(409, {
      ok: false,
      code: "CHECKOUT_CHANGED",
      message: "Itens mudaram. Revise o checkout."
    });
    await page.getByRole("alert").filter({ hasText: "Itens mudaram. Revise o checkout." }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);

    const nextHit = page.waitForRequest("**/api/checkout");
    await button.click();
    await nextHit;
    assert.equal(requests.length, 2);
    assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey, "Preparation retry keeps logical checkout identity");
    assert.equal(requests[1].customer.cpf, "", "Saved identity is resolved by the server, never by provider CPF");
    prepareRelease(200, {
      ok: true,
      paymentMode: "test",
      publicKey: "TEST-public-key",
      subtotalInCents: 5100,
      discountInCents: 500,
      couponName: "Boas-vindas",
      shippingInCents: 1690,
      amountInCents: 6290
    });
    await page.getByRole("heading", { name: "Finalize seu pedido" }).waitFor();
    await page.waitForFunction(() => window.__brickCreates === 1);
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await button.waitFor();
    assert.equal(await page.evaluate(() => window.__brickUnmounts), 1);
    assert.equal(await page.locator('input[name="name"]').inputValue(), "Cliente Teste");
    assert.equal(await page.locator('input[name="email"]').inputValue(), "cliente@example.com");
    assert.equal(await page.locator('input[name="phone"]').inputValue(), "11999999999");
    assert.equal(await page.locator(`input[value="${secondAddress.id}"]`).isChecked(), true);
    assert.equal(await page.locator('input[name="couponCode"]').inputValue(), "BEMVINDO");
    const backRetry = page.waitForRequest("**/api/checkout");
    await button.click();
    await backRetry;
    assert.equal(requests[2].idempotencyKey, requests[1].idempotencyKey);
    assert.deepEqual(requests[2].address, requests[1].address);
    prepareRelease(200, {
      ok: true,
      paymentMode: "test",
      publicKey: "TEST-public-key",
      subtotalInCents: 5100,
      discountInCents: 500,
      couponName: "Boas-vindas",
      shippingInCents: 1690,
      amountInCents: 6290
    });
    await page.waitForFunction(() => window.__brickCreates === 2);
    await page.evaluate(async () => {
      try {
        await window.__brickCallbacks.onSubmit({
          formData: {
            payment_method_id: "visa",
            token: "test-card-token",
            payer: { identification: { type: "CPF", number: "12345678909" } }
          }
        });
      } catch {
        /* Expected identity conflict. */
      }
    });
    await page.getByRole("button", { name: "Revisar checkout" }).click();
    await page.getByRole("button", { name: "Alterar CPF" }).click();
    const cpfEditor = page.locator(".customer-cpf-field .customer-cpf-input input:not([readonly])");
    await cpfEditor.waitFor();
    assert.equal(await page.locator('input[name="name"]').inputValue(), "Cliente Teste", "Recovery preserves customer fields");
    await cpfEditor.fill("52998224725");
    const cpfSaveHit = page.waitForRequest("**/api/customer/cpf");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    assert.equal((await cpfSaveHit).postDataJSON().cpf, "52998224725");
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(addressSaves.length, 3, "Payment retries also leave saved addresses untouched");
    console.log(
      JSON.stringify({
        result: "PASS",
        savedCpfEnablesContinue: true,
        concurrentPreparationBlocked: true,
        retryAfter409: true,
        logicalKeyPreserved: true,
        missingSavedIdentityRecoverable: true,
        brickCreates: 2,
        addressSelectExpandEditDelete: true,
        editCancelAndExplicitSave: true,
        newAddressCancelAndSave: true,
        duplicateAddressBlocked: true,
        editorBlocksCheckout: true,
        addressNotResavedOnCheckout: true,
        shippingLoadingRetryAndSelection: shippingCalls >= 3,
        maxThree: true,
        mobileNoOverflow: true,
        backRestoresFormCouponAddress: true,
        brickUnmounted: true
      })
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
