import http from "k6/http";
import { check, sleep } from "k6";
import { loadTarget } from "./safety.js";

const baseUrl = loadTarget();

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<2500"] }
};

export default function () {
  const response = http.get(`${baseUrl}/`);
  check(response, { "home responde 200": (result) => result.status === 200 });
  sleep(1);
}
