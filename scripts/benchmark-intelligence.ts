import { randomUUID } from "node:crypto";

const baseUrl = process.env.INTELLIGENCE_BASE_URL ?? "http://localhost:3000";
if (/curtiz\.(com|com\.br)/iu.test(baseUrl) && process.env.ALLOW_PRODUCTION !== "true") {
  throw new Error("Benchmark recusado em produção. Use local ou staging.");
}
const requests = Math.max(10, Math.min(Number(process.env.BENCHMARK_REQUESTS ?? 200), 5_000));
const concurrency = Math.max(1, Math.min(Number(process.env.BENCHMARK_CONCURRENCY ?? 10), 100));

async function benchmark(
  name: string,
  makeRequest: (index: number) => Promise<Response>,
  amount = requests
) {
  const times: number[] = [];
  let successful = 0;
  const started = performance.now();
  for (let index = 0; index < amount; index += concurrency) {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, amount - index) }, async (_, offset) => {
        const requestStarted = performance.now();
        const response = await makeRequest(index + offset);
        times.push(performance.now() - requestStarted);
        if (response.ok) successful += 1;
      })
    );
  }
  times.sort((left, right) => left - right);
  const elapsed = performance.now() - started;
  const percentile = (value: number) =>
    times[Math.min(times.length - 1, Math.floor(times.length * value))]?.toFixed(1) ?? "0.0";
  console.log(
    JSON.stringify({
      name,
      requests: amount,
      successful,
      concurrency,
      throughputRps: Number((amount / (elapsed / 1_000)).toFixed(1)),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99)
    })
  );
}

async function main() {
  await benchmark("catalog-baseline", () => fetch(`${baseUrl}/api/catalog?limite=8`));
  await benchmark("recommendations", () =>
    fetch(`${baseUrl}/api/intelligence/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "discovery",
        sessionId: "11111111-1111-4111-8111-111111111111",
        seen: [],
        recent: [],
        seed: "benchmark",
        limit: 8
      })
    })
  );
  await benchmark(
    "event-batches",
    () =>
      fetch(`${baseUrl}/api/intelligence/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `curtiz-cookie-preferences=${encodeURIComponent(JSON.stringify({ essential: true, analytics: true }))}`
        },
        body: JSON.stringify({
          sessionId: "11111111-1111-4111-8111-111111111111",
          consent: true,
          events: [
            {
              id: randomUUID(),
              type: "page_view",
              occurredAt: new Date().toISOString(),
              device: "desktop",
              path: "/benchmark"
            }
          ]
        })
      }),
    Math.min(requests, 500)
  );
}

void main();
