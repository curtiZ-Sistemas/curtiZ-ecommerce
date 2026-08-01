export const panelRoleToDatabaseRole = {
  operacional: "operational",
  administracao: "admin",
  gerencia: "manager",
  tecnico: "technical"
} as const;

export type PanelRouteRole = keyof typeof panelRoleToDatabaseRole;
export type InternalDatabaseRole = (typeof panelRoleToDatabaseRole)[PanelRouteRole];

export const databaseRoleToPanelPath = (roles: readonly string[]): string | null => {
  const priority: readonly InternalDatabaseRole[] = ["admin", "manager", "technical", "operational"];
  const selected = priority.find((role) => roles.includes(role));
  if (!selected) return null;
  const entry = Object.entries(panelRoleToDatabaseRole).find(([, role]) => role === selected);
  return entry ? `/${entry[0]}` : null;
};

