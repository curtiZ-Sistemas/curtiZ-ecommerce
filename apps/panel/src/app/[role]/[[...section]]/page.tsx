import {
  Activity,
  BadgeDollarSign,
  Boxes,
  CircleCheck,
  Clock3,
  Headphones,
  RotateCcw,
  ShoppingBag,
  Webhook
} from "lucide-react";
import { notFound } from "next/navigation";
import { PanelShell, type PanelRole } from "@/components/panel-shell";
import { RevenueChart } from "@/components/revenue-chart";
import { SupportConsole } from "@/components/support-console";
import { RepresentativeConsole } from "@/components/representative-console";
import { HomepageBuilder } from "@/components/homepage-builder";
import { OperationalConsole } from "@/components/operational-console";
import { ProductManagement } from "@/components/product-management";
import { requirePanelAccess } from "@/lib/auth";

const roles = new Set<PanelRole>(["operacional", "administracao", "gerencia", "tecnico"]);

export default async function RolePage({
  params
}: {
  params: Promise<{ role: string; section?: string[] }>;
}) {
  const resolved = await params;
  if (!roles.has(resolved.role as PanelRole)) notFound();
  const role = resolved.role as PanelRole;

  const section = resolved.section?.[0] ?? "";
  const currentPath = `/${role}${section ? `/${section}` : ""}`;
  await requirePanelAccess(role, currentPath);
  const representativeSections = new Set([
    "representantes",
    "solicitacoes-representantes",
    "kits-representantes",
    "regras-representantes",
    "comissoes-representantes",
    "integridade-representantes",
    "criativos"
  ]);

  return (
    <PanelShell role={role} section={section}>
      <PageHeading role={role} section={section} />
      {section === "atendimentos" ? (
        <SupportConsole role={role} />
      ) : representativeSections.has(section) ? (
        <RepresentativeConsole role={role} section={section} />
      ) : role === "operacional" ? (
        <Operational section={section} />
      ) : role === "administracao" ? (
        <Administration section={section} />
      ) : role === "gerencia" ? (
        <Management section={section} />
      ) : (
        <Technical section={section} />
      )}
    </PanelShell>
  );
}

function PageHeading({ role, section }: { role: PanelRole; section: string }) {
  const titles: Record<PanelRole, string> = {
    operacional: section ? titleCase(section) : "Fila operacional",
    administracao: section ? titleCase(section) : "Gestão comercial",
    gerencia: section ? titleCase(section) : "Visão estratégica",
    tecnico: section ? titleCase(section) : "Saúde do sistema"
  };
  return (
    <div className="page-heading">
      <div>
        <h1>{titles[role]}</h1>
        <p>
          {role === "operacional"
            ? "Execute as filas diárias com conferência e rastreabilidade."
            : "Informações internas conforme as permissões do perfil."}
        </p>
      </div>
    </div>
  );
}

function Operational({ section }: { section: string }) {
  return <OperationalConsole section={section} />;
}

function Administration({ section }: { section: string }) {
  if (section === "produtos") return <Products />;
  if (section === "estoque") return <Inventory />;
  if (section === "promocoes") return <Promotions />;
  if (section === "usuarios") return <UsersPanel />;
  if (section === "conteudo" || section === "construtor") return <HomepageBuilder />;
  if (section === "cms-legado") return <Cms />;
  return (
    <>
      <div className="metric-grid">
        <Metric label="Pedidos hoje" value="312" trend="+9,2%" icon={<ShoppingBag />} />
        <Metric
          label="Faturamento comercial"
          value="R$ 48.920"
          trend="+16,4%"
          icon={<BadgeDollarSign />}
        />
        <Metric label="Estoque baixo" value="18" trend="Atenção" icon={<Boxes />} />
        <Metric label="Atendimentos na fila" value="7" trend="2 urgentes" icon={<Headphones />} />
      </div>
      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Pedidos recentes</h2>
          <OrdersTable />
        </section>
        <section className="panel-card">
          <h2>Atividades recentes</h2>
          <Compact label="Produto atualizado" detail="Alteração registrada" value="10:24" />
          <Compact label="Cupom publicado" detail="PRIMEIRA15" value="09:15" />
          <Compact label="Atendimento assumido" detail="ATD-7F9C2A10" value="08:42" />
        </section>
      </div>
    </>
  );
}

function Management({ section }: { section: string }) {
  if (section === "financeiro") return <Financial />;
  if (section === "aprovacoes") return <Approvals />;
  return (
    <>
      <div className="metric-grid">
        <Metric
          label="Faturamento bruto"
          value="R$ 2,84 mi"
          trend="+18,7%"
          icon={<BadgeDollarSign />}
        />
        <Metric
          label="Faturamento líquido"
          value="R$ 2,45 mi"
          trend="+16,9%"
          icon={<CircleCheck />}
        />
        <Metric label="Lucro estimado" value="R$ 731 mil" trend="+21,3%" icon={<Activity />} />
        <Metric label="Reembolsos" value="R$ 49 mil" trend="-8,6%" icon={<RotateCcw />} />
      </div>
      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Faturamento ao longo do tempo</h2>
          <RevenueChart />
        </section>
        <section className="panel-card">
          <h2>Aprovações pendentes</h2>
          <Compact label="Reembolso elevado" detail="Pedidos aguardando análise" value="2" />
          <Compact label="Ajuste de estoque" detail="Acima do limite" value="3" />
          <Compact label="Conta privilegiada" detail="Requer AAL2" value="1" />
        </section>
      </div>
    </>
  );
}

function Technical({ section }: { section: string }) {
  if (section === "integracoes") return <Integrations />;
  if (section === "webhooks") return <Webhooks />;
  return (
    <>
      <div className="metric-grid">
        <Metric label="Aplicação" value="Local" trend="Online" icon={<CircleCheck />} />
        <Metric label="Banco de dados" value="—" trend="Não configurado" icon={<Boxes />} />
        <Metric label="Mercado Pago" value="—" trend="Aguardando credenciais" icon={<Webhook />} />
        <Metric label="Último backup" value="—" trend="Não configurado" icon={<Clock3 />} />
      </div>
      <div className="dashboard-grid">
        <section className="panel-card">
          <h2>Eventos recentes</h2>
          <EventsTable />
        </section>
        <section className="panel-card">
          <h2>Estado dos serviços</h2>
          <Compact label="Loja Next.js" detail="Verificação desta aplicação" value="Online" />
          <Compact label="Supabase" detail="Sem URL/chave local" value="Não configurado" />
          <Compact label="E-mail" detail="Serviço não configurado" value="Não configurado" />
          <Compact label="Frete" detail="Serviço não configurado" value="Não configurado" />
        </section>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  trend,
  icon
}: {
  label: string;
  value: string;
  trend: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </article>
  );
}

function OrdersTable({ operational = false }: { operational?: boolean }) {
  const rows = [
    ["#CZT-10245", "Cliente J.", "São Paulo, SP", "Em separação", "Hoje 18:00"],
    ["#CZT-10244", "Cliente R.", "Curitiba, PR", "Em separação", "Hoje 16:00"],
    ["#CZT-10243", "Cliente C.", "Rio de Janeiro, RJ", "Pronto para envio", "Hoje 16:00"],
    ["#CZT-10242", "Cliente A.", "Belo Horizonte, MG", "Enviado", "Ontem 17:10"]
  ];
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Cliente mascarado</th>
            <th>Cidade</th>
            <th>Status</th>
            <th>Prazo</th>
            {operational && <th>Ação</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={`${row[0]}-${cell}`}>
                  {index === 3 ? <span className="status orange">{cell}</span> : cell}
                </td>
              ))}
              {operational && (
                <td>
                  <button className="secondary-button">Assumir</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Compact({ label, detail, value }: { label: string; detail: string; value: string }) {
  return (
    <div className="compact-item">
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function Products() {
  return <ProductManagement />;
}

function Inventory() {
  return (
    <div className="dashboard-grid">
      <section className="panel-card">
        <h2>Estoque por variante</h2>
        <Compact label="Wave Preto 41/42" detail="Disponível 156 • Reservado 8" value="164 total" />
        <Compact label="Slim Coral 39/40" detail="Disponível 73 • Reservado 4" value="77 total" />
        <Compact label="Comfort Areia 37" detail="Disponível 64 • Reservado 3" value="67 total" />
      </section>
      <section className="panel-card">
        <h2>Ações controladas</h2>
        <p>Ajustes elevados exigem justificativa, auditoria e aprovação da Gerência.</p>
        <button className="primary-button">Nova contagem</button>
      </section>
    </div>
  );
}

function Promotions() {
  return (
    <div className="dashboard-grid">
      <section className="panel-card">
        <h2>Campanhas e cupons</h2>
        <Compact label="PRIMEIRA15" detail="Primeira compra • não combinável" value="Ativo" />
        <Compact label="FRETEGRATIS" detail="Acima de R$ 149" value="Ativo" />
        <Compact label="KITVERAO" detail="Compre X, ganhe Y" value="Programado" />
      </section>
      <section className="panel-card">
        <h2>Motor de promoções</h2>
        <p>Todos os critérios são recalculados no servidor e resgates são idempotentes.</p>
        <button className="primary-button">Criar promoção</button>
      </section>
    </div>
  );
}

function UsersPanel() {
  return (
    <section className="panel-card">
      <div className="page-heading">
        <h2>Usuários internos</h2>
        <button className="primary-button">Criar acesso</button>
      </div>
      <p>Contas privilegiadas exigem MFA, reautenticação, motivo e possível segunda aprovação.</p>
      <p>Os usuários autorizados aparecem aqui quando o diretório de identidades está conectado.</p>
    </section>
  );
}

function Cms() {
  return (
    <section className="panel-card">
      <h2>Conteúdo e SEO</h2>
      <Compact label="Página inicial" detail="Revisão 3 • Publicada" value="Editar" />
      <Compact label="Política de trocas" detail="Revisão 2 • Publicada" value="Editar" />
      <Compact label="Coleção Verão" detail="Rascunho" value="Revisar" />
      <p className="demo-status">Conteúdo rico será sanitizado; HTML inseguro é bloqueado.</p>
    </section>
  );
}

function Financial() {
  return (
    <div className="dashboard-grid">
      <section className="panel-card">
        <h2>Conciliação Mercado Pago</h2>
        <Compact label="Pagamento conciliado" detail="Bruto R$ 134,80 • Taxa R$ 6,41" value="Conciliado" />
        <Compact label="Divergência financeira" detail="Diferença de R$ 2,10" value="Revisar" />
      </section>
      <section className="panel-card">
        <h2>Fechamento</h2>
        <p>
          Períodos fechados ficam bloqueados. Somente Gerência pode reabrir com motivo auditado.
        </p>
        <button className="primary-button">Iniciar fechamento</button>
      </section>
    </div>
  );
}

function Approvals() {
  return (
    <section className="panel-card">
      <h2>Aprovações pendentes</h2>
      <Compact
        label="Reembolso acima do limite"
        detail="R$ 489,90 • motivo registrado"
        value="Analisar"
      />
      <Compact
        label="Ajuste de inventário"
        detail="+42 unidades • sessão INV-03"
        value="Analisar"
      />
      <Compact label="Novo usuário Técnico" detail="AAL2 obrigatório" value="Analisar" />
    </section>
  );
}

function Integrations() {
  const rows = [
    ["Supabase", "Não configurado", "URL e publishable key ausentes"],
    ["Mercado Pago", "Aguardando credenciais", "Serviço ainda não configurado"],
    ["Frete", "Não configurado", "Melhor Envio/Correios disponíveis por adapter"],
    ["E-mail", "Não configurado", "Fila local sem provider transacional"],
    ["WhatsApp", "Não configurado", "Somente API oficial Meta"],
    ["ERP", "Não configurado", "Bling e Omie por adapter"]
  ];
  return (
    <div className="integration-grid">
      {rows.map(([name, state, detail]) => (
        <article className="integration" key={name}>
          <header>
            <strong>{name}</strong>
            <span className="status gray">{state}</span>
          </header>
          <p>{detail}</p>
        </article>
      ))}
    </div>
  );
}

function Webhooks() {
  return (
    <section className="panel-card">
      <h2>Webhooks e filas</h2>
      <p>Nenhum evento real foi recebido. O painel não simula integrações conectadas.</p>
      <Compact label="Fila de e-mail" detail="Provider não configurado" value="0 pendentes" />
      <Compact
        label="Mercado Pago"
        detail="Assinatura e idempotência obrigatórias"
        value="0 eventos"
      />
    </section>
  );
}

function EventsTable() {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Fonte</th>
            <th>Evento</th>
            <th>Nível</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Agora</td>
            <td>panel</td>
            <td>Aplicação inicializada</td>
            <td>
              <span className="status blue">INFO</span>
            </td>
          </tr>
          <tr>
            <td>Agora</td>
            <td>supabase</td>
            <td>Integração não configurada</td>
            <td>
              <span className="status orange">WARNING</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
}
