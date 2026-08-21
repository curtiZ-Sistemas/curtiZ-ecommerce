import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
if (/curtiz\.(com|com\.br)/i.test(baseUrl) && __ENV.ALLOW_PRODUCTION !== "true")
  throw new Error("Teste recusado em produção. Use staging ou local.");
export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200"],
    checks: ["rate>0.99"]
  }
};
export default function () {
  const session = "11111111-1111-4111-8111-111111111111";
  const recommendations = http.post(
    `${baseUrl}/api/intelligence/recommendations`,
    JSON.stringify({
      source: "discovery",
      sessionId: session,
      seen: [],
      recent: [],
      seed: `load-${__VU}`,
      limit: 8
    }),
    { headers: { "content-type": "application/json", origin: baseUrl } }
  );
  check(recommendations, { "recommendations respondem": (response) => response.status === 200 });
  const events = http.post(
    `${baseUrl}/api/intelligence/events`,
    JSON.stringify({
      sessionId: session,
      consent: true,
      events: [
        {
          id: `${String(__VU).padStart(8, "0")}-1111-4111-8111-${String(__ITER).padStart(12, "0")}`,
          type: "page_view",
          occurredAt: new Date().toISOString(),
          device: "desktop",
          path: "/load-test"
        }
      ]
    }),
    {
      headers: {
        "content-type": "application/json",
        origin: baseUrl,
        cookie: `curtiz-cookie-preferences=${encodeURIComponent(JSON.stringify({ essential: true, analytics: true }))}`
      }
    }
  );
  check(events, {
    "lote aceito": (response) => response.status === 202 || response.status === 429
  });
  sleep(1);
}
