import { chromium, devices, type Response } from "@playwright/test";

type ShiftSource = {
  previousRect: DOMRectReadOnly;
  currentRect: DOMRectReadOnly;
  node?: HTMLElement;
};
type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources?: ShiftSource[];
};
type LcpEntry = PerformanceEntry & {
  size: number;
  url?: string;
  element?: HTMLElement;
};
type PerformanceReport = {
  cls: number;
  shifts: unknown[];
  lcp: unknown;
  longTasks: unknown[];
};
type ResourceReport = {
  type: string;
  url: string;
  status: number;
  bytes: number;
  cacheControl: string | null;
  cfCacheStatus: string | null;
};

declare global {
  interface Window {
    __curtizPerformance: PerformanceReport;
  }
}

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
const targetUrl =
  argumentsList.find((argument) => /^https?:\/\//u.test(argument)) ?? "https://curtiz.com.br";
const includeWarmCache = argumentsList.includes("--warm");
const assertBudgets = argumentsList.includes("--assert");
const strictBudgets = argumentsList.includes("--strict");
const profiles = [
  {
    name: "mobile",
    context: devices["Pixel 7"],
    network: {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      connectionType: "cellular4g" as const
    },
    cpuRate: 4
  },
  {
    name: "desktop",
    context: devices["Desktop Chrome"],
    network: {
      offline: false,
      latency: 40,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
      connectionType: "wifi" as const
    },
    cpuRate: 1
  }
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const reports: unknown[] = [];

  try {
    for (const profile of profiles) {
      const context = await browser.newContext({
        ...profile.context,
        serviceWorkers: "block"
      });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send("Network.enable");
      await client.send("Network.emulateNetworkConditions", profile.network);
      await client.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });

      await page.addInitScript(() => {
        window.__curtizPerformance = { cls: 0, shifts: [], lcp: null, longTasks: [] };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as LayoutShiftEntry[]) {
            if (!entry.hadRecentInput) {
              window.__curtizPerformance.cls += entry.value;
              window.__curtizPerformance.shifts.push({
                value: entry.value,
                startTime: entry.startTime,
                sources: (entry.sources ?? []).map((source) => ({
                  previousRect: source.previousRect,
                  currentRect: source.currentRect,
                  node: source.node?.outerHTML?.slice(0, 240) ?? null
                }))
              });
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          const entry = (list.getEntries() as LcpEntry[]).at(-1);
          if (!entry) return;
          window.__curtizPerformance.lcp = {
            startTime: entry.startTime,
            size: entry.size,
            url: entry.url || null,
            element: entry.element?.outerHTML?.slice(0, 400) ?? null
          };
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__curtizPerformance.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration
            });
          }
        }).observe({ type: "longtask", buffered: true });
      });

      let responses: Response[] = [];
      page.on("response", (response) => {
        responses.push(response);
      });

      for (const cacheMode of includeWarmCache
        ? (["cold", "warm"] as const)
        : (["cold"] as const)) {
        responses = [];
        await client.send("Network.setCacheDisabled", { cacheDisabled: cacheMode === "cold" });
        const startedAt = Date.now();
        const documentResponse = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 90_000
        });
        await page.waitForTimeout(12_000);

        const resources: ResourceReport[] = [];
        for (const response of responses) {
          const request = response.request();
          const sizes = await request.sizes().catch(() => null);
          if (!sizes) continue;
          resources.push({
            type: request.resourceType(),
            url: response.url(),
            status: response.status(),
            bytes: Math.max(0, sizes.responseBodySize),
            cacheControl: response.headers()["cache-control"] ?? null,
            cfCacheStatus: response.headers()["cf-cache-status"] ?? null
          });
        }

        const metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0] as
            PerformanceNavigationTiming | undefined;
          const lcp = window.__curtizPerformance.lcp as {
            startTime?: number;
            url?: string | null;
          } | null;
          const lcpResource = lcp?.url
            ? (performance.getEntriesByName(lcp.url)[0] as PerformanceResourceTiming | undefined)
            : undefined;
          return {
            ...window.__curtizPerformance,
            lcpBreakdown:
              lcpResource && lcp?.startTime
                ? {
                    discovery: lcpResource.requestStart,
                    timeToFirstByte: lcpResource.responseStart - lcpResource.requestStart,
                    download: lcpResource.responseEnd - lcpResource.responseStart,
                    renderDelay: Math.max(0, lcp.startTime - lcpResource.responseEnd)
                  }
                : null,
            fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
            domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
            load: navigation?.loadEventEnd ?? null,
            domNodes: document.getElementsByTagName("*").length
          };
        });
        const totalBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
        const imageBytes = resources
          .filter((resource) => resource.type === "image")
          .reduce((total, resource) => total + resource.bytes, 0);
        const scriptBytes = resources
          .filter((resource) => resource.type === "script")
          .reduce((total, resource) => total + resource.bytes, 0);
        const cssBytes = resources
          .filter((resource) => resource.type === "stylesheet")
          .reduce((total, resource) => total + resource.bytes, 0);

        reports.push({
          profile: profile.name,
          cache: cacheMode,
          url: page.url(),
          status: documentResponse?.status() ?? null,
          elapsedMs: Date.now() - startedAt,
          requests: resources.length,
          totalBytes,
          imageBytes,
          scriptBytes,
          cssBytes,
          metrics,
          largestResources: resources.sort((left, right) => right.bytes - left.bytes).slice(0, 12)
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(reports, null, 2));

  if (assertBudgets) {
    const failures: string[] = [];
    for (const report of reports as Array<{
      profile: string;
      cache: string;
      totalBytes: number;
      imageBytes: number;
      scriptBytes: number;
      metrics: { cls: number; lcp: { startTime?: number } | null; longTasks: unknown[] };
    }>) {
      if (report.cache !== "cold") continue;
      const lcpBudget = strictBudgets
        ? report.profile === "mobile"
          ? 2_500
          : 1_000
        : report.profile === "mobile"
          ? 8_000
          : 1_500;
      if (report.metrics.cls > 0.05)
        failures.push(`${report.profile}: CLS ${report.metrics.cls} > 0.05`);
      if ((report.metrics.lcp?.startTime ?? Infinity) > lcpBudget)
        failures.push(
          `${report.profile}: LCP ${report.metrics.lcp?.startTime ?? "ausente"}ms > ${lcpBudget}ms`
        );
      if (report.totalBytes > 750 * 1024)
        failures.push(`${report.profile}: payload inicial acima de 750 KiB`);
      if (report.imageBytes > 280 * 1024)
        failures.push(`${report.profile}: imagens acima de 280 KiB`);
      if (report.scriptBytes > 220 * 1024)
        failures.push(`${report.profile}: JavaScript acima de 220 KiB`);
      const longTaskBudget = strictBudgets ? 4 : 8;
      if (report.metrics.longTasks.length > longTaskBudget)
        failures.push(`${report.profile}: mais de ${longTaskBudget} tarefas longas`);
    }
    if (failures.length) throw new Error(`Performance budgets excedidos:\n${failures.join("\n")}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Performance measurement failed");
  process.exitCode = 1;
});
