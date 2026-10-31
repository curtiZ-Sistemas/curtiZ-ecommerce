import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendInvoiceEmail } from "./invoice-email";

const input = { apiKey: "test-key", from: "store@example.invalid", to: "customer@example.invalid", orderCode: "CZ-TEST",
  storeUrl: "https://store.example.invalid", idempotencyKey: "bling-invoice:test-order:123" };
describe("fiscal notification via Resend", () => {
  it("records a real acceptance ID, links to the authenticated account and sends an idempotency header", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "email-test-123" })));
    expect(await sendInvoiceEmail(input, transport)).toBe("email-test-123");
    expect(transport.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ "idempotency-key": input.idempotencyKey });
    const raw = transport.mock.calls[0]?.[1]?.body;
    const body = typeof raw === "string" ? raw : "";
    expect(body).toContain("https://store.example.invalid/minha-conta");
    expect(body).not.toContain("test-key");
  });
  it("never reports success on timeout, missing provider ID or missing configuration", async () => {
    await expect(sendInvoiceEmail(input, vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"))))
      .rejects.toMatchObject({ code: "email_acceptance_uncertain", uncertainWrite: true });
    await expect(sendInvoiceEmail(input, vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"))))
      .rejects.toMatchObject({ code: "email_acceptance_uncertain" });
    const transport = vi.fn<typeof fetch>();
    await expect(sendInvoiceEmail({ ...input, apiKey: "" }, transport)).rejects.toMatchObject({ code: "email_configuration" });
    expect(transport).not.toHaveBeenCalled();
  });
});
