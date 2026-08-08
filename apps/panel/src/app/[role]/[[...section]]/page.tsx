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
import { TechnicalOverview } from "@/components/technical-overview";
import { TechnicalResourceManager } from "@/components/technical-resource-manager";
import { LegalCenter, OperationalLegalLinks } from "@/components/legal-center";
import { HelpContentCenter } from "@/components/help-content-center";
import { requirePanelAccess } from "@/lib/auth";
import { isAdminResource } from "@/lib/admin-resources";
import { isManagerResource, type ManagerResourceKey } from "@/lib/manager-resources";
import { isTechnicalResource } from "@/lib/technical-resources";
import { hasMultipleSelectablePanels } from "@/lib/panel-roles";

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
  const access = await requirePanelAccess(role, currentPath);
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
    <PanelShell
      role={role}
      section={section}
      canSwitchPanel={hasMultipleSelectablePanels(access.roles)}
    >
      <PageHeading role={role} section={section} />
      {section === "central-ajuda" && role !== "tecnico" ? (
        <HelpContentCenter />
      ) : role === "administracao" ? (
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
    tecnico: section ? titleCase(section) : "Visão geral técnica"
  };
  return (
    <div className="page-heading">
      <div>
        <h1>{titles[role]}</h1>
        <p>
          {role === "operacional"
            ? "Execute as filas diárias com conferência e rastreabilidade."
            : role === "tecnico"
              ? "Monitore serviços e execute ações técnicas autorizadas sem expor segredos."
              : "Informações internas conforme as permissões do perfil."}
        </p>
      </div>
    </div>
  );
}

function Operational({ section }: { section: string }) {
  if (section === "politicas") return <OperationalLegalLinks />;
  return <OperationalConsole section={section} />;
}

function Administration({ section }: { section: string }) {
  if (!section) return <AdminDashboard />;
  if (section === "produtos" || section === "estoque") return <ProductManagement />;
  if (section === "construtor-home") return <HomepageBuilder />;
  if (section === "usuarios") return <AdminUsers />;
  if (section === "permissoes") return <AdminPermissions />;
  if (section === "politicas") return <LegalCenter />;
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
  if (!section || section === "visao-estrategica" || section === "alertas")
    return <ManagerDashboard />;
  if (section === "conteudo-loja") return <HomepageBuilder showVersions />;
  if (section === "aprovacoes") return <ManagerApprovals />;
  if (section === "politicas") return <LegalCenter />;
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

  return (
    <div className="admin-empty-state">
      <h2>Área gerencial não encontrada</h2>
      <p>Escolha uma opção disponível no menu.</p>
    </div>
  );
}

function Technical({ section }: { section: string }) {
  if (isTechnicalResource(section)) return <TechnicalResourceManager resource={section} />;
  return <TechnicalOverview section={section} />;
}

function ManagerApprovals() {
  return (
    <section className="panel-card manager-approvals">
      <h2>Central de aprovações</h2>
      <p>As decisões permanecem nos fluxos de origem e são validadas no servidor.</p>
      <div className="manager-approval-links">
        <Link href="/gerencia/solicitacoes-representantes">
          <strong>Solicitações de representantes</strong>
          <small>Documentos, análise e decisão justificada</small>
        </Link>
        <Link href="/gerencia/conteudo-loja">
          <strong>Conteúdo da loja</strong>
          <small>Publicação, agenda e restauração de versões</small>
        </Link>
        <Link href="/gerencia/criativos">
          <strong>Criativos</strong>
          <small>Aprovação simples ou dupla conforme a campanha</small>
        </Link>
        <Link href="/gerencia/campanhas">
          <strong>Campanhas</strong>
          <small>Agenda e estados persistidos de publicação</small>
        </Link>
        <Link href="/gerencia/fechamentos">
          <strong>Fechamentos de comissão</strong>
          <small>Aprovar, bloquear ou reabrir com auditoria</small>
        </Link>
      </div>
    </section>
  );
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("-", " ");
}
