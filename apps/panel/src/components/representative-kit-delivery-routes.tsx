"use client";

import { formatBRL } from "@curtiz/domain";
import { type FormEvent, useState } from "react";
import { z } from "zod";

const routeResponse = z.object({ rows: z.array(z.object({
  id: z.string(), name: z.string(), origin_postal_code: z.string(), destination_from: z.string(),
  destination_through: z.string(), delivery_cents: z.number(), estimated_days: z.number(),
  valid_until: z.iso.datetime({ offset: true }), closed_at: z.string().nullable()
})) });
type DeliveryRoute = z.infer<typeof routeResponse>["rows"][number];

const api = "/api/operations/representative-kits";
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

function maskPostalCode(value: string): string {
  const digits = value.replace(/\D/gu, "").slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function postalCodeDigits(value: string): string {
  return value.replace(/\D/gu, "");
}

export function RepresentativeKitDeliveryRoutes() {
  const [routes, setRoutes] = useState<DeliveryRoute[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState<DeliveryRoute | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [postalCodes, setPostalCodes] = useState({ origin: "", from: "", through: "" });

  async function readRoutes() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${api}?mode=routes`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível consultar as rotas.");
      const data = routeResponse.safeParse(await response.json());
      if (!data.success) throw new Error("A resposta de rotas está inválida.");
      setRoutes(data.data.rows);
    } catch {
      setError("Não foi possível carregar as rotas. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar as rotas.");
    } finally {
      setPending(false);
    }
  }

  async function mutate(data: object) {
    const response = await fetch(api, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data)
    });
    if (!response.ok) {
      const result: unknown = await response.json().catch(() => null);
      const details = z.object({ message: z.string() }).safeParse(result);
      throw new Error(details.success ? details.data.message : "Confira a vigência, os CEPs e os dados de recebimento.");
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry.trim() : "";
    };
    const from = postalCodeDigits(postalCodes.from);
    const through = postalCodeDigits(postalCodes.through);
    if (from > through) {
      setError("O último CEP atendido precisa ser igual ou maior que o primeiro.");
      return;
    }

    void run(async () => {
      await mutate({ action: "create_route", route: {
        name: value("name"), origin_postal_code: postalCodeDigits(postalCodes.origin),
        destination_from: from, destination_through: through, delivery_cents: 0,
        estimated_days: Number(value("days")), valid_until: `${value("validUntil")}T23:59:59-03:00`,
        point_terminal_id: null, verified_evidence: value("evidence"),
        bling_method_ids: value("cash") ? { cash: value("cash") } : {}
      } });
      form.reset();
      setFormOpen(false);
      setPostalCodes({ origin: "", from: "", through: "" });
      setMessage("Rota cadastrada.");
      await readRoutes();
    });
  }

  return <details className="representative-kit-delivery-routes" onToggle={event => {
    if (event.currentTarget.open && routes === null && !loading) void readRoutes();
  }}>
    <summary>
      <span>
        <strong>Logística e entrega própria</strong>
        <small>Rotas comerciais em Minas Gerais, quando aplicável</small>
      </span>
      <span className="representative-kit-route-summary-action">Gerenciar rotas</span>
    </summary>

    <div className="representative-kit-route-panel">
      <header className="representative-kit-route-heading">
        <div>
          <h2>Entrega própria em Minas Gerais</h2>
          <p>Use esta seção apenas para modalidades atendidas por uma rota própria. Outras formas de entrega continuam independentes deste cadastro.</p>
        </div>
        <div className="representative-kit-route-heading-actions">
          <button type="button" className="secondary-button" disabled={loading || pending} onClick={() => void readRoutes()}>
            {loading ? "Atualizando…" : "Atualizar rotas"}
          </button>
          <button type="button" className="primary-button" disabled={loading || pending || routes === null || formOpen}
            onClick={() => { setError(""); setMessage(""); setFormOpen(true); }}>Nova rota</button>
        </div>
      </header>

      {error && <p className="representative-kit-route-feedback is-error" role="alert">{error}</p>}
      {message && <p className="representative-kit-route-feedback" role="status">{message}</p>}
      {loading && routes === null ? <p className="representative-kit-route-state" role="status">Carregando rotas…</p> : null}

      {routes && <section className="representative-kit-route-list" aria-labelledby="representative-kit-route-list-title">
        <h3 id="representative-kit-route-list-title">Rotas cadastradas <span>{routes.length}</span></h3>
        {routes.length === 0 ? <p className="representative-kit-route-state">Nenhuma rota cadastrada. O cadastro só é necessário para entregas próprias.</p> :
          <ul>{routes.map(route => <li key={route.id}>
            <div className="representative-kit-route-details">
              <strong>{route.name}</strong>
              <span>Saída {maskPostalCode(route.origin_postal_code)} · atende {maskPostalCode(route.destination_from)} a {maskPostalCode(route.destination_through)}</span>
              <span>{formatBRL(route.delivery_cents)} · {route.estimated_days} dia(s) · {route.closed_at ? "Encerrada" : `Válida até ${dateFormat.format(new Date(route.valid_until))}`}</span>
            </div>
            {!route.closed_at && <button type="button" className="secondary-button danger-button" disabled={pending}
              onClick={() => setClosing(route)}>Encerrar rota</button>}
          </li>)}</ul>}

        {closing && <div className="representative-kit-route-confirm" role="alert">
          <div><strong>Encerrar “{closing.name}”?</strong><p>A rota deixa de ser considerada em novas consultas de entrega.</p></div>
          <div>
            <button type="button" className="danger-button" disabled={pending} onClick={() => void run(async () => {
              await mutate({ action: "close_route", routeId: closing.id });
              setClosing(null);
              setMessage("Rota encerrada.");
              await readRoutes();
            })}>{pending ? "Encerrando…" : "Confirmar encerramento"}</button>
            <button type="button" className="secondary-button" disabled={pending} onClick={() => setClosing(null)}>Cancelar</button>
          </div>
        </div>}
      </section>}

      {routes && formOpen && <form onSubmit={save} className="representative-kit-route-form" aria-busy={pending}>
        <fieldset disabled={pending || loading}>
          <legend>Cadastrar uma rota</legend>
          <p className="representative-kit-route-form-note">Os campos abaixo atendem somente à entrega própria. O sistema valida a vigência e a cobertura dos CEPs antes de salvar.</p>
          <div className="representative-kit-route-fields">
            <label className="representative-kit-route-field-wide">Nome da rota
              <input name="name" minLength={3} maxLength={100} autoComplete="off" placeholder="Ex.: Região central" required />
            </label>
            <label>CEP de saída
              <input name="origin" value={postalCodes.origin} onChange={event => { setError(""); setPostalCodes(current => ({ ...current, origin: maskPostalCode(event.target.value) })); }}
                inputMode="numeric" autoComplete="postal-code" pattern="3\d{4}-\d{3}" maxLength={9} placeholder="30000-000" title="Informe um CEP de Minas Gerais." required />
            </label>
            <label>Primeiro CEP atendido
              <input name="from" value={postalCodes.from} onChange={event => { setError(""); setPostalCodes(current => ({ ...current, from: maskPostalCode(event.target.value) })); }}
                inputMode="numeric" pattern="3\d{4}-\d{3}" maxLength={9} placeholder="30000-000" title="Informe um CEP de Minas Gerais." required />
            </label>
            <label>Último CEP atendido
              <input name="through" value={postalCodes.through} onChange={event => { setError(""); setPostalCodes(current => ({ ...current, through: maskPostalCode(event.target.value) })); }}
                inputMode="numeric" pattern="3\d{4}-\d{3}" maxLength={9} placeholder="39999-999" title="Informe um CEP de Minas Gerais." required />
            </label>
            <label>Prazo em dias
              <input name="days" type="number" min={0} max={60} step={1} inputMode="numeric" required />
            </label>
            <label>Válida até
              <input name="validUntil" type="date" required />
            </label>
            <label>ID no Bling para dinheiro no recebimento <span>(opcional)</span>
              <input name="cash" inputMode="numeric" pattern="[1-9][0-9]{0,14}" maxLength={15} placeholder="Somente se essa forma estiver habilitada" />
            </label>
            <label>Referência da conferência da rota
              <input name="evidence" minLength={10} maxLength={500} placeholder="Documento ou registro interno consultável" required />
            </label>
          </div>
          <label className="representative-kit-route-free-delivery">
            <input type="checkbox" checked disabled readOnly />
            <span>Entrega sem taxa adicional <small>(única condição aceita para entrega própria)</small></span>
          </label>
          <div className="representative-kit-route-actions">
            <button type="submit" className="primary-button" disabled={pending}>{pending ? "Salvando rota…" : "Cadastrar rota"}</button>
            <button type="button" className="secondary-button" disabled={pending}
              onClick={() => { setFormOpen(false); setError(""); setPostalCodes({ origin: "", from: "", through: "" }); }}>Cancelar</button>
          </div>
        </fieldset>
      </form>}
    </div>
  </details>;
}
