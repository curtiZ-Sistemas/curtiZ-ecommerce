// Identidade de cada painel, compartilhada pelo shell (cliente) e pela tela de seleção (servidor).
export type PanelIdentityRole = "operacional" | "administracao" | "gerencia" | "tecnico";

export const panelPurposes: Record<PanelIdentityRole, string> = {
  operacional: "Execute pedidos e filas do dia com rastreabilidade.",
  administracao: "Mantenha catálogo, clientes e operação comercial organizados.",
  gerencia: "Priorize decisões, aprovações e resultados do negócio.",
  tecnico: "Monitore a plataforma e trate incidentes com segurança."
};
