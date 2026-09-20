import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { melhorEnvioStatusTransition, verifyMelhorEnvioSignature } from "./melhor-envio-webhook";

describe("webhook Melhor Envio", () => {
  it("valida a assinatura oficial HMAC-SHA256 em base64 sobre o corpo bruto", () => {
    const body = new TextEncoder().encode('{"event":"order.posted"}');
    const signature = createHmac("sha256", "app-secret").update(body).digest("base64");
    expect(verifyMelhorEnvioSignature(body, signature, "app-secret")).toBe(true);
    expect(verifyMelhorEnvioSignature(body, signature, "other-secret")).toBe(false);
    expect(verifyMelhorEnvioSignature(body, "invalid", "app-secret")).toBe(false);
  });

  it("normaliza estados sem deixar evento antigo regredir a remessa", () => {
    expect(melhorEnvioStatusTransition("ready", "order.posted", "posted")).toEqual({ status: "dispatched", rank: 4 });
    expect(melhorEnvioStatusTransition("delivered", "order.posted", "posted")).toBeNull();
    expect(melhorEnvioStatusTransition("in_transit", "order.delivered", "delivered"))
      .toEqual({ status: "delivered", rank: 7 });
    expect(melhorEnvioStatusTransition("pending", "unknown", "unknown")).toBeNull();
  });
});
