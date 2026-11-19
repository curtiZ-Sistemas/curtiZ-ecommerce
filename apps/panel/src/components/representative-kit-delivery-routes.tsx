"use client";

import { formatBRL, parseBRLToCents } from "@curtiz/domain";
import { type FormEvent, useState } from "react";
import { z } from "zod";

const routeResponse = z.object({ rows: z.array(z.object({
  id: z.string(), name: z.string(), origin_postal_code: z.string(), destination_from: z.string(),
  destination_through: z.string(), delivery_cents: z.number(), estimated_days: z.number(),
  valid_until: z.iso.datetime({ offset: true }), closed_at: z.string().nullable()
})) });
type DeliveryRoute = z.infer<typeof routeResponse>["rows"][number];

const api = "/api/operations/representative-kits";
const paymentFields = [
  ["cash", "Dinheiro"], ["pix", "Pix"], ["debit_card", "Débito"], ["credit_card", "Crédito"]
] as const;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export function RepresentativeKitDeliveryRoutes() {
  const [routes, setRoutes] = useState<DeliveryRoute[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState<DeliveryRoute | null>(null);

  async function readRoutes() {
    const response = await fetch(`${api}?mode=routes`, { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível consultar as rotas.");
    const data = routeResponse.safeParse(await response.json());
    if (!data.success) throw new Error("Não foi possível consultar as rotas.");
    setRoutes(data.data.rows);
  }

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try { await operation(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível atualizar as rotas."); }
    finally { setPending(false); }
  }

  async function mutate(data: object) {
    const response = await fetch(api, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error("Confira a vigência, os CEPs e os dados de recebimento.");
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry.trim() : "";
    };
    void run(async () => {
      await mutate({ action: "create_route", route: {
        name: value("name"), origin_postal_code: value("origin"), destination_from: value("from"),
        destination_through: value("through"), delivery_cents: parseBRLToCents(value("fee")),
        estimated_days: Number(value("days")), valid_until: `${value("validUntil")}T23:59:59-03:00`,
        point_terminal_id: value("terminal"), verified_evidence: value("evidence"),
        bling_method_ids: Object.fromEntries(paymentFields.map(([name]) => [name, value(name)]))
      } });
      form.reset();
      await readRoutes();
      setMessage("Rota cadastrada.");
    });
  }

  return <details>
    <summary>Rotas de entrega própria em MG</summary>
    <button type="button" className="secondary-button" disabled={pending} onClick={() => void run(readRoutes)}>
      {routes ? "Atualizar rotas" : "Consultar rotas"}
    </button>
    {message && <p role="status">{message}</p>}
    {routes && <>
      {routes.length === 0 && <p>Nenhuma rota cadastrada.</p>}
      <ul>
        {routes.map(route => <li key={route.id}>
          {route.name} · {route.origin_postal_code} → {route.destination_from} a {route.destination_through}
          {" · "}{formatBRL(route.delivery_cents)} · {route.estimated_days} dia(s)
          {" · "}{route.closed_at ? "Encerrada" : `Até ${dateFormat.format(new Date(route.valid_until))}`}
          {!route.closed_at && <button type="button" disabled={pending} onClick={() => setClosing(route)}>Encerrar</button>}
        </li>)}
      </ul>
      {closing && <div>
        <p>Tem certeza de que deseja encerrar a rota {closing.name}?</p>
        <button type="button" disabled={pending} onClick={() => void run(async () => {
          await mutate({ action: "close_route", routeId: closing.id });
          setClosing(null);
          await readRoutes();
          setMessage("Rota encerrada.");
        })}>Confirmar encerramento</button>
        <button type="button" disabled={pending} onClick={() => setClosing(null)}>Cancelar</button>
      </div>}
      <form onSubmit={save} className="admin-form-grid">
        <label>Nome da rota <input name="name" required minLength={3} maxLength={100} /></label>
        <label>CEP de saída <input name="origin" inputMode="numeric" pattern="3[0-9]{7}" required /></label>
        <label>Primeiro CEP atendido <input name="from" inputMode="numeric" pattern="3[0-9]{7}" required /></label>
        <label>Último CEP atendido <input name="through" inputMode="numeric" pattern="3[0-9]{7}" required /></label>
        <label>Taxa de entrega em reais <input name="fee" inputMode="decimal" placeholder="0,00" required /></label>
        <label>Prazo em dias <input name="days" type="number" min={0} max={60} required /></label>
        <label>Válida até <input name="validUntil" type="date" required /></label>
        <label>ID do terminal Point <input name="terminal" pattern="[A-Za-z0-9_]{4,80}" required /></label>
        {paymentFields.map(([name, label]) => <label key={name}>
          ID no Bling · {label} <input name={name} inputMode="numeric" pattern="[1-9][0-9]{0,14}" required />
        </label>)}
        <label className="wide">Referência da conferência da rota <input name="evidence" minLength={10} maxLength={500} required /></label>
        <button type="submit" className="primary-button" disabled={pending}>Cadastrar rota</button>
      </form>
    </>}
  </details>;
}
