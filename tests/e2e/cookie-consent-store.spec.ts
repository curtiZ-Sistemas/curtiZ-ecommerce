import { expect, test, type Page, type Request } from "@playwright/test";

// Executado nos projetos store-desktop e store-mobile (testMatch /store\.spec\.ts/).
// Sem Supabase no ambiente de E2E: a recusa usa a API real; o aceite registrado é simulado na rota.

const consentKey = "curtiz-cookie-consent";
const optionalRequest = (request: Request) =>
  /\/api\/(intelligence\/events|homepage-metrics)/u.test(request.url()) && request.method() === "POST";

function trackOptionalRequests(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => { if (optionalRequest(request)) requests.push(request); });
  return requests;
}

async function storedConsent(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as
    { id: string; policyVersion: string; categories: Record<string, boolean>; recordedAt: string } | null, consentKey);
}

async function mockRecordedConsent(page: Page) {
  await page.route("**/api/privacy/cookies", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { id: string };
    await route.fulfill({ json: { persisted: true, id: body.id, message: "Preferências registradas." } });
  });
  await page.route("**/api/intelligence/events", (route) =>
    route.fulfill({ status: route.request().method() === "POST" ? 202 : 200, json: { accepted: 1, forgotten: true } }));
}

const banner = (page: Page) => page.getByRole("region", { name: "Preferências de cookies" });

test.describe("consentimento de cookies", () => {
  test("primeira visita: aviso compacto e nenhuma coleta opcional antes da escolha", async ({ page, context }) => {
    const optional = trackOptionalRequests(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
    await page.goto("/produtos", { waitUntil: "networkidle" });
    await expect(banner(page)).toBeVisible();
    expect(optional).toHaveLength(0);
    const storage = await page.evaluate(() => ({
      session: sessionStorage.getItem("curtiz:intelligence-session"),
      recent: localStorage.getItem("curtiz:intelligence-recent"),
      searches: localStorage.getItem("curtiz-recent-searches")
    }));
    expect(storage).toEqual({ session: null, recent: null, searches: null });
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("curtiz-cookie-preferences");
    const viewport = page.viewportSize();
    const bounds = await page.locator(".cookie-consent-card").boundingBox();
    expect(bounds && viewport && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("recusa vale após recarregar, grava cookie httpOnly assinado e não coleta", async ({ page, context }) => {
    const optional = trackOptionalRequests(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Recusar opcionais" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect((await storedConsent(page))?.categories).toMatchObject({ essential: true, preferences: false, analytics: false });
    const serverCookie = (await context.cookies()).find((cookie) => cookie.name === "curtiz-cookie-preferences");
    expect(serverCookie?.httpOnly).toBe(true);
    expect(serverCookie?.sameSite).toBe("Lax");
    expect(serverCookie?.value).toMatch(/^[\w-]+\.[\w-]+$/u);
    await page.reload({ waitUntil: "networkidle" });
    await expect(banner(page)).toHaveCount(0);
    expect(optional).toHaveLength(0);
  });

  test("falha ao registrar o aceite mantém opcionais desligados e informa o erro", async ({ page }) => {
    const optional = trackOptionalRequests(page);
    await page.route("**/api/privacy/cookies", (route) => route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { persisted: false, message: "Não foi possível registrar as preferências." } })
      : route.fallback());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Aceitar opcionais" }).click();
    await expect(banner(page).getByRole("alert")).toContainText("Não foi possível registrar");
    await expect(banner(page)).toBeVisible();
    expect(await storedConsent(page)).toBeNull();
    expect(optional).toHaveLength(0);
  });

  test("personalização começa sem opções marcadas e essenciais não podem ser desligados", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Preferências" }).click();
    const essential = banner(page).getByRole("checkbox", { name: /Essenciais/u });
    await expect(essential).toBeChecked();
    await expect(essential).toBeDisabled();
    await expect(banner(page).getByRole("checkbox", { name: /Preferências/u })).not.toBeChecked();
    await expect(banner(page).getByRole("checkbox", { name: /Analytics/u })).not.toBeChecked();
    await expect(banner(page).getByRole("button", { name: "Recusar opcionais" })).toBeVisible();
  });

  test("aceite, revogação pelo rodapé e limpeza dos dados opcionais", async ({ page }) => {
    await mockRecordedConsent(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Preferências" }).click();
    await banner(page).getByRole("checkbox", { name: /Analytics/u }).check();
    const firstBatch = page.waitForRequest((request) => optionalRequest(request) && request.url().includes("/events"),
      { timeout: 20_000 });
    await banner(page).getByRole("button", { name: "Salvar preferências" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect((await storedConsent(page))?.categories).toMatchObject({ analytics: true, preferences: false });
    // O primeiro lote (page_view da autorização) sai pelo temporizador de 8 s.
    await firstBatch;
    expect(await page.evaluate(() => sessionStorage.getItem("curtiz:intelligence-session"))).toMatch(/^[0-9a-f-]{36}$/u);

    // Revogação pelo rodapé: apaga a sessão remota e local, e nada mais é enviado.
    await page.evaluate(() => localStorage.setItem("curtiz:intelligence-recent", "[]"));
    await page.getByRole("button", { name: "Preferências de cookies" }).click();
    await expect(page.locator(".cookie-consent-card")).toBeFocused();
    await expect(banner(page).getByRole("checkbox", { name: /Analytics/u })).toBeChecked();
    await banner(page).getByRole("checkbox", { name: /Analytics/u }).uncheck();
    const deletion = page.waitForRequest((request) =>
      request.url().includes("/api/intelligence/events") && request.method() === "DELETE");
    const consentPost = page.waitForRequest((request) =>
      request.url().includes("/api/privacy/cookies") && request.method() === "POST");
    await banner(page).getByRole("button", { name: "Salvar preferências" }).click();
    expect((await consentPost).postDataJSON()).toMatchObject({ revoked: true, categories: { analytics: false } });
    await deletion;
    const afterRevocation = trackOptionalRequests(page);
    expect(await page.evaluate(() => ({
      session: sessionStorage.getItem("curtiz:intelligence-session"),
      recent: localStorage.getItem("curtiz:intelligence-recent")
    }))).toEqual({ session: null, recent: null });
    await page.goto("/produtos", { waitUntil: "networkidle" });
    expect(afterRevocation).toHaveLength(0);
  });

  test("painel do rodapé fecha com Esc e com o botão Fechar sem exigir nova escolha", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Recusar opcionais" }).click();
    await page.getByRole("button", { name: "Preferências de cookies" }).click();
    await expect(page.locator(".cookie-consent-card")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(banner(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Preferências de cookies" }).click();
    await banner(page).getByRole("button", { name: "Fechar preferências" }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test("escolha expirada ou de política anterior é solicitada novamente", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Recusar opcionais" }).click();
    const current = await storedConsent(page);
    for (const changed of [
      { ...current, recordedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString() },
      { ...current, policyVersion: "cookies-draft-inventory-2" }
    ]) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [consentKey, JSON.stringify(changed)] as const);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(banner(page)).toBeVisible({ timeout: 15_000 });
      await expect(banner(page).getByRole("button", { name: "Aceitar opcionais" })).toBeVisible();
    }
  });

  test("escolha feita em outra aba é aplicada nesta", async ({ page, context }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
    const other = await context.newPage();
    await other.goto("/", { waitUntil: "domcontentloaded" });
    await banner(other).getByRole("button", { name: "Recusar opcionais" }).click();
    await expect(banner(page)).toHaveCount(0);
    await other.close();
  });

  test("recusa preserva carrinho e favoritos e não bloqueia a navegação de compra", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("curtiz-favorites", "[]");
      localStorage.setItem("curtiz-recent-searches", JSON.stringify(["chinelo"]));
    });
    await banner(page).getByRole("button", { name: "Recusar opcionais" }).click();
    expect(await page.evaluate(() => ({
      favorites: localStorage.getItem("curtiz-favorites"),
      searches: localStorage.getItem("curtiz-recent-searches")
    }))).toEqual({ favorites: "[]", searches: null });
    await page.goto("/carrinho", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test("servidor ignora consentimento forjado no navegador", async ({ page, context, baseURL }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const origin = new URL(baseURL ?? page.url()).origin;
    await context.addCookies([{
      name: "curtiz-cookie-preferences",
      value: encodeURIComponent(JSON.stringify({ essential: true, analytics: true })),
      url: origin
    }]);
    const response = await page.request.post("/api/intelligence/events", {
      headers: { origin, "content-type": "application/json" },
      data: { sessionId: "11111111-1111-4111-8111-111111111111", consent: true, events: [{
        id: "22222222-2222-4222-8222-222222222222", type: "page_view",
        occurredAt: new Date().toISOString(), device: "desktop", path: "/"
      }] }
    });
    expect(response.status()).toBe(403);
    const crossSite = await page.request.post("/api/privacy/cookies", {
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      data: { id: "11111111-1111-4111-8111-111111111111", policyVersion: "cookies-draft-inventory-3",
        categories: { essential: true, analytics: true }, origin: "banner", revoked: false }
    });
    expect(crossSite.status()).toBe(403);
  });

  test("login e logout mantêm a escolha do dispositivo", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await banner(page).getByRole("button", { name: "Recusar opcionais" }).click();
    await expect(banner(page)).toHaveCount(0);
    const before = await storedConsent(page);
    expect(before?.categories).toMatchObject({ analytics: false, preferences: false });
    await page.getByLabel("E-mail de acesso").fill("cliente.demo@curtiz.local");
    await page.locator('input[name="password"]:visible').fill("1234567890");
    await page.getByRole("button", { name: "Entrar na minha conta" }).click();
    await expect(page).toHaveURL(/\/minha-conta$/u, { timeout: 30_000 });
    await expect(banner(page)).toHaveCount(0);
    await expect(page.locator(".account-action")).toHaveAttribute("href", "/minha-conta", { timeout: 30_000 });
    await page.getByRole("button", { name: "Sair da conta" }).first().click();
    await expect(page).toHaveURL(/\/login$/u, { timeout: 30_000 });
    expect(await storedConsent(page)).toEqual(before);
    await expect(banner(page)).toHaveCount(0);
  });
});
