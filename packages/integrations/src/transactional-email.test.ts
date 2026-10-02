import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderTransactionalEmail, sendTransactionalEmail, getTransactionalEmailStatus, type EmailOrder } from "./transactional-email";
const order: EmailOrder = { code: "CZT-TEST", email: "buyer@example.com", name: "João <script>", subtotal: 100, discount: 10,
  shipping: 15, fees: 0, total: 105, address: "Rua Teste, 1, São Paulo, SP",
  items: [{ name: "Sandália & conforto", color: "Vinho", size: "37", quantity: 2, unitPrice: 50, total: 100 }] };
const render = (kind: "purchase_confirmed" | "review_requested") => renderTransactionalEmail({ kind, order,
  from: "curti Z <pedidos@example.com>", replyTo: "suporte@example.com", storeUrl: "https://store.example.com", messageId: "test-message" });
describe("two transactional email templates", () => {
  it("includes persisted amounts, variations, safe content and actual account links", () => {
    const payload = render("purchase_confirmed");
    expect(payload.text).toContain("105,00"); expect(payload.text).toContain("Desconto: −R$");
    expect(payload.text).toContain("Quantidade: 2"); expect(payload.text).toContain("Vinho · 37");
    expect(payload.html).toContain("João &lt;script&gt;"); expect(payload.html).not.toContain("<script>");
    expect(payload.html).toContain("Sandália &amp; conforto");
    expect(payload.html).toContain('href="https://store.example.com/minha-conta/pedidos"');
    expect(payload.reply_to).toBe("suporte@example.com");
    expect(payload.html).toContain("max-width:600px"); expect(payload.html).toContain('width="100%"');
    expect(payload.html).toContain("#62130f"); expect(payload.html).toContain("#eeeeee");
    expect(payload.html).not.toContain("@import");
  });
  it("requests review without offers and uses the existing protected reviews section", () => {
    const payload = render("review_requested");
    expect(payload.text).toContain("pedido foi entregue");
    expect(payload.text).toContain("https://store.example.com/minha-conta/avaliacoes");
    expect(payload.text).not.toContain("Total:"); expect(payload.text).not.toContain("cupom");
    expect(payload.html).toContain("Avaliar compra");
  });
  it("omits optional name/address/discount and rejects malformed order snapshots", () => {
    const input = { kind: "purchase_confirmed" as const, order: { ...order, name: "", address: "", discount: 0 },
      from: "pedidos@example.com", replyTo: "pedidos@example.com", storeUrl: "https://store.example.com", messageId: "test" };
    expect(renderTransactionalEmail(input).text).not.toContain("Entrega:");
    expect(renderTransactionalEmail(input).text).not.toContain("Desconto:");
    expect(() => renderTransactionalEmail({ ...input, order: { ...order, total: NaN } })).toThrow("invalid_order_snapshot");
    expect(() => renderTransactionalEmail({ ...input, storeUrl: "https://user:pass@example.com" })).toThrow("email_configuration");
  });
});
describe("Resend fetch adapter for Workers", () => {
  it("sends stable payload/idempotency headers and records acceptance only", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test"}'));
    expect(await sendTransactionalEmail("test-key", render("purchase_confirmed"), "resend:purchase:test", transport)).toBe("provider-test");
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "error", headers: { "idempotency-key": "resend:purchase:test" },
      body: JSON.stringify(render("purchase_confirmed")) });
  });
  it.each([429, 503])("treats %s as transient and preserves Retry-After", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status, headers: { "retry-after": "600" } }));
    await expect(sendTransactionalEmail("test-key", render("purchase_confirmed"), "test", transport))
      .rejects.toMatchObject({ retryable: true, uncertain: status >= 500, retryAfterSeconds: 600 });
  });
  it("classifies timeout and invalid success receipt as uncertain", async () => {
    await expect(sendTransactionalEmail("test-key", render("purchase_confirmed"), "test", vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"))))
      .rejects.toMatchObject({ uncertain: true, retryable: true });
    await expect(sendTransactionalEmail("test-key", render("purchase_confirmed"), "test", vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))))
      .rejects.toMatchObject({ uncertain: true });
  });
  it("only retries concurrent idempotent requests, not payload conflicts or bad credentials", async () => {
    for (const name of ["concurrent_idempotent_requests", "invalid_idempotent_request"]) {
      await expect(sendTransactionalEmail("test-key", render("purchase_confirmed"), "test",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ name }), { status: 409 }))))
        .rejects.toMatchObject({ retryable: name === "concurrent_idempotent_requests" });
    }
    const transport = vi.fn<typeof fetch>();
    await expect(sendTransactionalEmail("", render("purchase_confirmed"), "test", transport)).rejects.toMatchObject({ code: "email_configuration" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("retrieves actual delivery separately without resending", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test","last_event":"delivered"}'));
    expect(await getTransactionalEmailStatus("test-key", "provider-test", transport)).toBe("delivered");
    expect(transport.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it("recognizes recipient suppression as a provider result", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"provider-test","last_event":"suppressed"}'));
    expect(await getTransactionalEmailStatus("test-key", "provider-test", transport)).toBe("suppressed");
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});
