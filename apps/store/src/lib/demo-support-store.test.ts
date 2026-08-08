import { describe, expect, it } from "vitest";
import {
  addDemoSupportMessage,
  claimDemoSupport,
  createDemoSupport,
  DemoSupportError,
  listDemoSupport,
  setDemoSupportPriority,
  transferDemoSupport
} from "./demo-support-store";

const customer = {
  email: `cliente-${crypto.randomUUID()}@curtiz.local`,
  fullName: "Cliente de Teste",
  role: "customer" as const
};

const admin = {
  email: "admin.demo@curtiz.local",
  fullName: "Administrador Demo",
  role: "admin" as const
};

const manager = {
  email: "gerencia.demo@curtiz.local",
  fullName: "Gerência Demo",
  role: "manager" as const
};

const operational = {
  email: "operacional.demo@curtiz.local",
  fullName: "Operacional Demo",
  role: "operational" as const
};

function createTicket() {
  return createDemoSupport(customer, {
    category: "order",
    message: "Preciso de ajuda para acompanhar o meu pedido.",
    requestId: crypto.randomUUID(),
    subject: "Acompanhamento do pedido"
  });
}

describe("demo support authorization and workflow", () => {
  it("is idempotent and isolates customer conversations", () => {
    const requestId = crypto.randomUUID();
    const input = {
      category: "delivery" as const,
      message: "Minha entrega não recebeu uma atualização recente.",
      requestId,
      subject: "Atualização da entrega"
    };
    const first = createDemoSupport(customer, input);
    const duplicate = createDemoSupport(customer, input);
    const otherCustomer = {
      email: `outro-${crypto.randomUUID()}@curtiz.local`,
      fullName: "Outro Cliente",
      role: "customer" as const
    };

    expect(duplicate.id).toBe(first.id);
    expect(first).not.toHaveProperty("customerEmail");
    expect(first).not.toHaveProperty("assignedEmail");
    expect(first).not.toHaveProperty("requestId");
    expect(listDemoSupport(otherCustomer).some((item) => item.id === first.id)).toBe(false);
  });

  it("prevents two agents from claiming the same conversation", () => {
    const ticket = createTicket();
    claimDemoSupport(admin, ticket.id);

    expect(() => claimDemoSupport(manager, ticket.id)).toThrow(DemoSupportError);
  });

  it("never exposes internal notes to the customer", () => {
    const ticket = createTicket();
    claimDemoSupport(admin, ticket.id);
    addDemoSupportMessage(admin, ticket.id, "Validar o evento com a transportadora.", true);

    const customerView = listDemoSupport(customer).find((item) => item.id === ticket.id);
    const adminView = listDemoSupport(admin).find((item) => item.id === ticket.id);
    expect(customerView?.messages.some((message) => message.author === "internal")).toBe(false);
    expect(adminView?.messages.some((message) => message.author === "internal")).toBe(true);
  });

  it("only exposes transferred tickets to the operational assignee", () => {
    const ticket = createTicket();
    claimDemoSupport(admin, ticket.id);
    transferDemoSupport(admin, ticket.id, "operational", "Separação precisa verificar o volume.");

    expect(listDemoSupport(operational).some((item) => item.id === ticket.id)).toBe(true);
    addDemoSupportMessage(operational, ticket.id, "O volume foi localizado e seguirá para expedição.", false);
    expect(() => addDemoSupportMessage(operational, ticket.id, "Nota proibida.", true)).toThrow(
      DemoSupportError
    );
  });

  it("persists priority changes instead of simulating success", () => {
    const ticket = createTicket();
    claimDemoSupport(admin, ticket.id);

    setDemoSupportPriority(admin, ticket.id, "urgent", "Cliente aguarda uma correÃ§Ã£o imediata.");

    expect(listDemoSupport(admin).find((item) => item.id === ticket.id)?.priority).toBe("urgent");
  });
});
