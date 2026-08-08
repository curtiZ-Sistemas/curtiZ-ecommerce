import {
  Boxes,
  CircleCheck,
  Clock3,
  Webhook
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PanelShell, type PanelRole } from "@/components/panel-shell";
import { SupportConsole } from "@/components/support-console";
import { RepresentativeConsole } from "@/components/representative-console";
import { HomepageBuilder } from "@/components/homepage-builder";
import { OperationalConsole } from "@/components/operational-console";
import { ProductManagement } from "@/components/product-management";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminPermissions } from "@/components/admin-permissions";
import { AdminResourceManager } from "@/components/admin-resource-manager";
import { AdminUsers } from "@/components/admin-users";
import { ManagerDashboard } from "@/components/manager-dashboard";
import { ManagerResourceManager } from "@/components/manager-resource-manager";
import { requirePanelAccess } from "@/lib/auth";
import { isAdminResource } from "@/lib/admin-resources";
import { isManagerResource, type ManagerResourceKey } from "@/lib/manager-resources";

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
      {role === "administracao" ? (
        <Administration section={section} />
      ) : section === "atendimentos" ? (
        <SupportConsole role={role} />
      ) : representativeSections.has(section) && role !== "gerencia" ? (
        <RepresentativeConsole role={role} section={section} />
      ) : role === "operacional" ? (
        <Operational section={section} />
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
  if (!section) return <AdminDashboard />;
  if (section === "produtos" || section === "estoque") return <ProductManagement />;
  if (section === "construtor-home") return <HomepageBuilder />;
  if (section === "usuarios") return <AdminUsers />;
  if (section === "permissoes") return <AdminPermissions />;
  if (section === "representantes" || section === "criativos") {
    return <RepresentativeConsole role="administracao" section={section} />;
  }
  if (isAdminResource(section)) return <AdminResourceManager resource={section} />;
  return (
    <div className="admin-empty-state">
      <h2>Área administrativa não encontrada</h2>
      <p>Escolha uma opção disponível no menu.</p>
    </div>
  );
}

function Management({ section }: { section: string }) {
  if (!section || section === "visao-estrategica" || section === "alertas") return <ManagerDashboard />;
  if (section === "conteudo-loja") return <HomepageBuilder showVersions />;
  if (section === "aprovacoes") return <ManagerApprovals />;
  if (section === "solicitacoes-representantes" || section === "criativos") {
    return <RepresentativeConsole role="gerencia" section={section} />;
  }
  if (["niveis", "metas", "kits", "banners"].includes(section)) {
    return <AdminResourceManager resource={section as "niveis" | "metas" | "kits" | "banners"} />;
  }
  if (section === "regras-comissao") return <AdminResourceManager resource="comissoes" />;

  const aliases: Record<string, ManagerResourceKey> = {
    vendas: "pedidos-vendas",
    "comissoes-representantes": "comissoes"
  };
  const resource = aliases[section] ?? section;
  if (isManagerResource(resource)) return <ManagerResourceManager resource={resource} />;

  return <div className="admin-empty-state"><h2>Área gerencial não encontrada</h2><p>Escolha uma opção disponível no menu.</p></div>;
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

function ManagerApprovals() {
  return (
    <section className="panel-card manager-approvals">
      <h2>Central de aprovações</h2>
      <p>As decisões permanecem nos fluxos de origem e são validadas no servidor.</p>
      <div className="manager-approval-links">
        <Link href="/gerencia/solicitacoes-representantes"><strong>Solicitações de representantes</strong><small>Documentos, análise e decisão justificada</small></Link>
        <Link href="/gerencia/conteudo-loja"><strong>Conteúdo da loja</strong><small>Publicação, agenda e restauração de versões</small></Link>
        <Link href="/gerencia/criativos"><strong>Criativos</strong><small>Aprovação simples ou dupla conforme a campanha</small></Link>
        <Link href="/gerencia/campanhas"><strong>Campanhas</strong><small>Agenda e estados persistidos de publicação</small></Link>
        <Link href="/gerencia/fechamentos"><strong>Fechamentos de comissão</strong><small>Aprovar, bloquear ou reabrir com auditoria</small></Link>
      </div>
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
