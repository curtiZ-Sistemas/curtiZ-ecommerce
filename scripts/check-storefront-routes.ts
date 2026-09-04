import { chromium, devices } from "@playwright/test";

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
const baseUrl =
  argumentsList.find((argument) => /^https?:\/\//u.test(argument)) ?? "http://localhost:3000";
const routes = [
  "/",
  "/produtos",
  "/masculino",
  "/feminino",
  "/infantil",
  "/slides",
  "/sandalias",
  "/lancamentos",
  "/ofertas",
  "/mais-vendidos",
  "/produto/flip-flop-wave-preto"
] as const;
const profiles = [
  ["mobile", devices["Pixel 7"]],
  ["desktop", devices["Desktop Chrome"]]
] as const;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  try {
    for (const [profile, device] of profiles) {
      const context = await browser.newContext({ ...device, serviceWorkers: "block" });
      for (const route of routes) {
        const page = await context.newPage();
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error" && /hydration|hydrated|uncaught/iu.test(message.text())) {
            runtimeErrors.push(message.text());
          }
        });
        await page.addInitScript(() => {
          (window as Window & { __routeCls?: number }).__routeCls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<
              PerformanceEntry & { value: number; hadRecentInput: boolean }
            >) {
              if (!entry.hadRecentInput) {
                (window as Window & { __routeCls?: number }).__routeCls! += entry.value;
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
        });
        const response = await page.goto(new URL(route, baseUrl).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 60_000
        });
        await page.waitForTimeout(800);
        const state = await page.evaluate(() => ({
          cls: (window as Window & { __routeCls?: number }).__routeCls ?? 0,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          contentLength: document.body.textContent?.trim().length ?? 0,
          imagesWithoutDimensions: [...document.images].filter((image) => {
            const style = getComputedStyle(image);
            return !image.width && !image.height && style.aspectRatio === "auto";
          }).length,
          eagerVideos: [...document.querySelectorAll("video")].filter(
            (video) => video.preload !== "none"
          ).length
        }));
        const status = response?.status() ?? 0;
        results.push({ profile, route, status, ...state, runtimeErrors });
        if (status < 200 || status >= 500) failures.push(`${profile} ${route}: HTTP ${status}`);
        if (state.contentLength < 20) failures.push(`${profile} ${route}: conteúdo ausente`);
        if (state.overflow > 1)
          failures.push(`${profile} ${route}: overflow horizontal ${state.overflow}px`);
        if (state.cls > 0.1) failures.push(`${profile} ${route}: CLS ${state.cls}`);
        if (state.imagesWithoutDimensions)
          failures.push(`${profile} ${route}: mídia sem dimensões`);
        if (state.eagerVideos) failures.push(`${profile} ${route}: vídeo com preload antecipado`);
        if (runtimeErrors.length)
          failures.push(`${profile} ${route}: ${runtimeErrors.join(" | ")}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) throw new Error(`Falhas nas rotas da loja:\n${failures.join("\n")}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Route check failed");
  process.exitCode = 1;
});
