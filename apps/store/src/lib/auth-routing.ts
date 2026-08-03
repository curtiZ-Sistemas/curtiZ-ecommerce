export const loginDestinations = {
  customer: "/minha-conta",
  representative: "/representante",
  operational: "/operacional",
  admin: "/administracao",
  manager: "/gerencia",
  technical: "/tecnico"
} as const;

export type LoginRole = keyof typeof loginDestinations;

const internalRolePriority: LoginRole[] = ["admin", "manager", "technical", "operational"];

export const resolveLoginRole = (roles: string[]): LoginRole | null => {
  const internalRole = internalRolePriority.find((role) => roles.includes(role));
  if (internalRole) return internalRole;
  if (roles.includes("representative")) return "representative";
  if (roles.includes("customer")) return "customer";
  return null;
};
