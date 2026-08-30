export const loginDestinations = {
  customer: "/minha-conta",
  representative: "/minha-conta",
  operational: "/operacional",
  admin: "/administracao",
  manager: "/gerencia",
  technical: "/tecnico"
} as const;

export type LoginRole = keyof typeof loginDestinations;

const selectablePanelRoles = ["admin", "operational", "manager"] as const;

const internalRolePriority: LoginRole[] = ["admin", "manager", "technical", "operational"];

export const resolveLoginRole = (roles: string[]): LoginRole | null => {
  const internalRole = internalRolePriority.find((role) => roles.includes(role));
  if (internalRole) return internalRole;
  if (roles.includes("representative")) return "representative";
  if (roles.includes("customer")) return "customer";
  return null;
};

export const resolveLoginDestination = (roles: string[]): string | null => {
  const selectableCount = selectablePanelRoles.filter((role) => roles.includes(role)).length;
  if (selectableCount >= 2) return "/selecionar-painel";
  const role = resolveLoginRole(roles);
  return role ? loginDestinations[role] : null;
};

export const resolvePostLoginDestination = (destination: string): string => {
  if (
    destination === "/representante" ||
    destination.startsWith("/representante/") ||
    destination.startsWith("/representante?") ||
    destination.startsWith("/representante#")
  ) {
    return loginDestinations.customer;
  }
  return destination;
};
