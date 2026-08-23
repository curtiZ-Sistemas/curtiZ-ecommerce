export const panelDefinitions = {
  administracao: {
    databaseRole: "admin",
    label: "Painel Administrativo",
    contextLabel: "Administrador",
    href: "/administracao",
    description: "Produtos, clientes, marketing, usuários e configurações.",
    selectable: true
  },
  operacional: {
    databaseRole: "operational",
    label: "Painel Operacional",
    contextLabel: "Operacional",
    href: "/operacional",
    description: "Pedidos, estoque, separação, expedição e atendimento.",
    selectable: true
  },
  gerencia: {
    databaseRole: "manager",
    label: "Painel Gerencial",
    contextLabel: "Gerência",
    href: "/gerencia",
    description: "Financeiro, relatórios, aprovações e visão estratégica.",
    selectable: true
  },
  tecnico: {
    databaseRole: "technical",
    label: "Painel Técnico",
    contextLabel: "Técnico",
    href: "/tecnico",
    description: "Sistema, segurança, integrações e manutenção.",
    selectable: true
  }
} as const;

export const panelRoleToDatabaseRole = Object.fromEntries(
  Object.entries(panelDefinitions).map(([routeRole, definition]) => [routeRole, definition.databaseRole])
) as { [Role in keyof typeof panelDefinitions]: (typeof panelDefinitions)[Role]["databaseRole"] };

export type PanelRouteRole = keyof typeof panelRoleToDatabaseRole;
export type InternalDatabaseRole = (typeof panelRoleToDatabaseRole)[PanelRouteRole];

export const selectablePanelDefinitions = Object.entries(panelDefinitions)
  .filter((entry): entry is [PanelRouteRole, (typeof panelDefinitions)[PanelRouteRole]] => entry[1].selectable)
  .map(([routeRole, definition]) => ({ routeRole, ...definition }));

export const authorizedSelectablePanels = (roles: readonly string[]) =>
  selectablePanelDefinitions.filter((panel) => roles.includes(panel.databaseRole));

export const hasMultipleSelectablePanels = (roles: readonly string[]) =>
  authorizedSelectablePanels(roles).length >= 2;

export const hasPanelRouteAccess = (roles: readonly string[], routeRole: PanelRouteRole) =>
  roles.includes(panelRoleToDatabaseRole[routeRole]);

export const databaseRoleToPanelPath = (roles: readonly string[]): string | null => {
  if (hasMultipleSelectablePanels(roles)) return "/selecionar-painel";
  const priority: readonly InternalDatabaseRole[] = ["admin", "manager", "technical", "operational"];
  const selected = priority.find((role) => roles.includes(role));
  if (!selected) return null;
  const entry = Object.values(panelDefinitions).find((definition) => definition.databaseRole === selected);
  return entry?.href ?? null;
};
