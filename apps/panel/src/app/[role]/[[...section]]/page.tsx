import { notFound, redirect } from "next/navigation";
import { PanelPageHeading, PanelShell, type PanelRole } from "@/components/panel-shell";
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
import { ManagerStrategy } from "@/components/manager-strategy";
import { ManagerAlerts } from "@/components/manager-alerts";
import { ManagerApprovals } from "@/components/manager-approvals";
import { FinancialControl } from "@/components/financial-control";
import { ActivityLogs } from "@/components/activity-logs";
import { ManagerResourceManager } from "@/components/manager-resource-manager";
import { TechnicalOverview } from "@/components/technical-overview";
import { TechnicalResourceManager } from "@/components/technical-resource-manager";
import { LegalCenter, OperationalLegalLinks } from "@/components/legal-center";
import { HelpContentCenter } from "@/components/help-content-center";
import { StoreIntelligence } from "@/components/store-intelligence";
import { PromotionBarManager } from "@/components/promotion-bar-manager";
import { StoreNavigationManager } from "@/components/store-navigation-manager";
import { requirePanelAccess } from "@/lib/auth";
import { isAdminResource } from "@/lib/admin-resources";
import { isManagerResource, type ManagerResourceKey } from "@/lib/manager-resources";
import { isTechnicalResource } from "@/lib/technical-resources";
import { hasMultipleSelectablePanels } from "@/lib/panel-roles";
import { requestPublicAppUrls } from "@/lib/request-public-urls";

const roles = new Set<PanelRole>(["operacional", "administracao", "gerencia", "tecnico"]);

export default async function RolePage({
  params,
  searchParams
}: {
  params: Promise<{ role: string; section?: string[] }>;
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const resolved = await params;
  const resolvedSearch = await searchParams;
  if (!roles.has(resolved.role as PanelRole)) notFound();
  const role = resolved.role as PanelRole;

  const section = resolved.section?.[0] ?? "";
  const rawQuery = Array.isArray(resolvedSearch.q) ? resolvedSearch.q[0] : resolvedSearch.q;
  const initialQuery = rawQuery?.trim().slice(0, 120) ?? "";
  const rawStatus = Array.isArray(resolvedSearch.status)
    ? resolvedSearch.status[0]
    : resolvedSearch.status;
  const initialStatus = rawStatus?.trim().slice(0, 40) ?? "";
  const currentPath = `/${role}${section ? `/${section}` : ""}`;
  const access = await requirePanelAccess(role, currentPath);
  const { storeUrl } = await requestPublicAppUrls();
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
      userName={access.fullName}
      avatarUrl={access.avatarUrl}
      storeUrl={storeUrl}
      canSwitchPanel={hasMultipleSelectablePanels(access.roles)}
    >
      {showRouteHeading(role, section) ? <PanelPageHeading role={role} section={section} /> : null}
      {section === "central-ajuda" && role !== "tecnico" ? (
        <HelpContentCenter />
      ) : section === "atendimentos" ? (
        <SupportConsole role={role} />
      ) : role === "administracao" ? (
        <Administration section={section} initialQuery={initialQuery} draftOwnerKey={access.userId} />
      ) : representativeSections.has(section) && role !== "gerencia" ? (
        <RepresentativeConsole role={role} section={section} />
      ) : role === "operacional" ? (
        <Operational section={section} initialQuery={initialQuery} initialStatus={initialStatus} />
      ) : role === "gerencia" ? (
        <Management section={section} initialQuery={initialQuery} />
      ) : (
        <Technical section={section} initialQuery={initialQuery} />
      )}
    </PanelShell>
  );
}

function showRouteHeading(role: PanelRole, section: string) {
  if (!section) return role !== "gerencia";
  if (role === "administracao") {
    const ownsHeading =
      ["produtos", "produtos-arquivados", "navegacao-loja", "construtor-home", "barra-promocional", "usuarios", "permissoes"].includes(
        section
      ) || isAdminResource(section);
    return !ownsHeading;
  }
  if (role === "operacional") return section !== "construtor-home";
  if (role === "gerencia") {
    const alias =
      section === "vendas"
        ? "pedidos-vendas"
        : section === "comissoes-representantes"
          ? "comissoes"
          : section;
    const ownsHeading =
      section === "conteudo-loja" ||
      section === "barra-promocional" ||
      section === "inteligencia-loja" ||
      section === "visao-estrategica" ||
      section === "alertas" ||
      section === "financeiro" ||
      section === "auditoria" ||
      section === "usuarios" ||
      ["niveis", "metas", "kits", "banners", "regras-comissao"].includes(section) ||
      isManagerResource(alias);
    return !ownsHeading;
  }
  return !isTechnicalResource(section);
}

function Operational({
  section,
  initialQuery,
  initialStatus
}: {
  section: string;
  initialQuery: string;
  initialStatus: string;
}) {
  if (section === "politicas") return <OperationalLegalLinks />;
  if (section === "construtor-home") return <HomepageBuilder />;
  return (
    <OperationalConsole
      key={`${section}:${initialQuery}:${initialStatus}`}
      section={section}
      initialQuery={initialQuery}
      initialStatus={initialStatus}
    />
  );
}

function Administration({ section, initialQuery, draftOwnerKey }: { section: string; initialQuery: string; draftOwnerKey: string }) {
  if (!section) return <AdminDashboard />;
  if (["modelos", "variacoes", "midias", "estoque"].includes(section))
    redirect("/administracao/produtos");
  if (section === "configuracoes") redirect("/administracao");
  if (section === "produtos")
    return <ProductManagement key={`${section}:${initialQuery}`} initialQuery={initialQuery} draftOwnerKey={draftOwnerKey} />;
  if (section === "produtos-arquivados")
    return <ProductManagement key={`${section}:${initialQuery}`} initialQuery={initialQuery} draftOwnerKey={draftOwnerKey} catalogMode="archived" />;
  if (section === "navegacao-loja") return <StoreNavigationManager />;
  if (section === "construtor-home") return <HomepageBuilder />;
  if (section === "barra-promocional") return <PromotionBarManager />;
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

function Management({ section, initialQuery }: { section: string; initialQuery: string }) {
  if (!section) return <ManagerDashboard />;
  if (section === "visao-estrategica") return <ManagerStrategy />;
  if (section === "alertas") return <ManagerAlerts />;
  if (section === "conteudo-loja") return <HomepageBuilder showVersions />;
  if (section === "barra-promocional") return <PromotionBarManager />;
  if (section === "inteligencia-loja") return <StoreIntelligence />;
  if (section === "financeiro") return <FinancialControl />;
  if (section === "auditoria") return <ActivityLogs />;
  if (section === "usuarios") return <AdminUsers />;
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
  if (isManagerResource(resource))
    return (
      <ManagerResourceManager
        key={`${resource}:${initialQuery}`}
        resource={resource}
        initialQuery={initialQuery}
      />
    );

  return (
    <div className="admin-empty-state">
      <h2>Área gerencial não encontrada</h2>
      <p>Escolha uma opção disponível no menu.</p>
    </div>
  );
}

function Technical({ section, initialQuery }: { section: string; initialQuery: string }) {
  if (section === "acessos-tecnicos") return <AdminUsers />;
  if (isTechnicalResource(section))
    return (
      <TechnicalResourceManager
        key={`${section}:${initialQuery}`}
        resource={section}
        initialQuery={initialQuery}
      />
    );
  return <TechnicalOverview section={section} />;
}
