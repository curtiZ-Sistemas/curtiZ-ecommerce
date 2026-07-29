import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    checkout: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "30s"
    }
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"] }
};

export default function () {
  const response = http.post(
    `${__ENV.BASE_URL || "http://localhost:3000"}/api/checkout`,
    JSON.stringify({ invalid: true }),
    { headers: { "content-type": "application/json" } }
  );
  check(response, { "payload inválido é rejeitado": (result) => result.status === 400 });
}
