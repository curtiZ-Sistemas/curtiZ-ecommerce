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

const targetUrl = process.argv.slice(2).find((argument) => argument !== "--") ?? "https://curtiz.com.br";
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
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
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

    const responses: Response[] = [];
    page.on("response", (response) => {
      responses.push(response);
    });

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
        bytes: sizes.responseBodySize,
        cacheControl: response.headers()["cache-control"] ?? null,
        cfCacheStatus: response.headers()["cf-cache-status"] ?? null
      });
    }

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        ...window.__curtizPerformance,
        fcp:
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
        load: navigation?.loadEventEnd ?? null,
        domNodes: document.getElementsByTagName("*").length
      };
    });
    const totalBytes = resources.reduce((total, resource) => total + resource.bytes, 0);
    const imageBytes = resources
      .filter((resource) => resource.type === "image")
      .reduce((total, resource) => total + resource.bytes, 0);

    reports.push({
      profile: profile.name,
      url: page.url(),
      status: documentResponse?.status() ?? null,
      elapsedMs: Date.now() - startedAt,
      requests: resources.length,
      totalBytes,
      imageBytes,
      metrics,
      largestResources: resources
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, 12)
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(reports, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Performance measurement failed");
  process.exitCode = 1;
});
