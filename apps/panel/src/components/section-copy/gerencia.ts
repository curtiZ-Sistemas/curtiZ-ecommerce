import type { SectionCopy } from "./types";

// Descrição de uma linha por rota do painel, exibida abaixo do título no cabeçalho do shell.
// Dono: Agente 3. Fiel ao que a tela realmente permite fazer; sem promessas nem dados inventados.
// Rotas com cabeçalho próprio (dashboard, financeiro, listas gerenciais, estratégia, inteligência,
// alertas e logs) mostram a descrição do próprio componente; o texto daqui vale para as demais.
export const gerenciaSectionCopy: SectionCopy = {
  "visao-estrategica": "Compare faturamento, lucro e pedidos com o período anterior e veja produtos, categorias, regiões e metas.",
  financeiro: "Acompanhe caixa, contas a receber e a pagar, lançamentos e aportes do período.",
  "pedidos-vendas": "Acompanhe pedidos, pagamentos e resultado disponível por período.",
  "inteligencia-loja": "Veja visualizações, favoritos, carrinhos e buscas agregadas para decidir catálogo e descoberta.",
  clientes: "Consulte os cadastros de clientes limitados aos dados necessários para análise gerencial.",
  representantes: "Consulte situação, nível e região da rede; suspensões e reativações exigem justificativa.",
  "solicitacoes-representantes": "Analise as solicitações de novos representantes e registre a decisão.",
  "rede-indicacoes": "Consulte a estrutura de indicações registrada entre representantes.",
  niveis: "Consulte e ajuste a configuração de progressão da rede.",
  qualificacao: "Consulte os resultados das regras de qualificação por período.",
  metas: "Consulte e ajuste as metas individuais ou por nível.",
  kits: "Acompanhe pedidos de kits, pagamentos e andamento logístico.",
  comissoes: "Consulte as comissões calculadas, com base, valor e situação.",
  "regras-comissao": "Consulte e ajuste as regras usadas no cálculo das comissões.",
  fechamentos: "Simule, aprove, bloqueie ou reabra fechamentos de comissão com registro em auditoria.",
  pagamentos: "Consulte os pagamentos de comissão efetivamente registrados.",
  criativos: "Revise os criativos enviados pela rede e registre a decisão.",
  campanhas: "Consulte as campanhas e altere o estado de aprovação e publicação com justificativa.",
  "barra-promocional": "Edite a mensagem da barra promocional exibida na loja.",
  "conteudo-loja": "Monte a página inicial da loja, agende publicações e restaure versões.",
  banners: "Consulte os banners da loja, destinos, agenda e estado de publicação.",
  relatorios: "Consulte o histórico de exportações solicitadas e o estado de cada uma.",
  aprovacoes: "Escolha a fila para decidir; cada aprovação acontece no fluxo de origem.",
  auditoria: "Consulte quem fez o quê, em qual área e quando, com os detalhes de cada registro.",
  usuarios: "Consulte as pessoas com acesso ao painel e seus papéis.",
  politicas: "Consulte as políticas e os textos de conformidade da loja.",
  simulacoes: "Simule fechamentos de comissão por período antes de enviá-los para aprovação.",
  alertas: "Veja as ocorrências que pedem acompanhamento e abra a área responsável.",
  "configuracoes-estrategicas": "Consulte as políticas comerciais versionadas em vigor.",
  atendimentos: "Acompanhe as conversas de atendimento com clientes.",
  "central-ajuda": "Consulte os artigos da Central de Ajuda."
};
