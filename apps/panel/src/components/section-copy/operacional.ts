import type { SectionCopy } from "./types";

// Descrição de uma linha por rota do painel, exibida abaixo do título no cabeçalho do shell.
// Dono: Agente 2. Fiel ao que a tela realmente permite fazer; sem promessas nem dados inventados.
export const operacionalSectionCopy: SectionCopy = {
  pedidos: "Busque pedidos, confira entrega e itens, inicie a separação ou a expedição e acompanhe a situação no Bling.",
  separacao: "Assuma tarefas de separação, confira cada item e registre divergências antes de concluir.",
  expedicao: "Assuma tarefas de expedição, confira os itens e conclua a conferência antes do despacho.",
  envio: "Assuma tarefas de envio, confira os itens e conclua a conferência de cada remessa.",
  estoque: "Consulte saldo, reservas, danos e mínimo de cada variação e solicite ajustes para aprovação.",
  reposicao: "Variações em estoque crítico, com movimentações recentes e ajustes solicitados.",
  danificados: "Variações com unidades danificadas; solicite ajustes para aprovação quando necessário.",
  kits: "Kits de representantes para montagem e conferência, sem acesso a comissões.",
  "montagem-kits": "Inicie a montagem dos kits pagos ou em separação e acompanhe o status de cada um.",
  "notas-fiscais": "Acompanhe status, referência e tentativas das notas fiscais dos pedidos, sem chaves do ERP.",
  trocas: "Trocas recebidas: registre a inspeção física e o destino de cada item.",
  devolucoes: "Trocas e devoluções recebidas: registre a inspeção física e o destino de cada item; o estorno não é feito aqui.",
  ocorrencias: "Registre divergências, danos e problemas de envio e acompanhe a resolução de cada ocorrência.",
  atendimentos: "Responda os atendimentos transferidos para você e registre a resolução de cada conversa.",
  pendencias: "Pedidos bloqueados, tarefas em aberto, ocorrências sem resolução e pendências do Bling em um só lugar.",
  "relatorios-operacionais": "Contagens atuais de cada fila operacional, sem valores financeiros ou estratégia comercial.",
  politicas: "Consulte e compartilhe as políticas publicadas e vigentes da loja."
};
