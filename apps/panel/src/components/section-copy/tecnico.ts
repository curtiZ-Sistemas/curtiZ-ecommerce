import type { SectionCopy } from "./types";

// Descrição de uma linha por rota do painel, exibida abaixo do título no cabeçalho do shell.
// Dono: Agente 4. Fiel ao que a tela realmente permite fazer; sem promessas nem dados inventados.
// Rotas de tabela (logs, erros, webhooks…) têm cabeçalho próprio com a descrição de lib/technical-resources.ts.
export const tecnicoSectionCopy: SectionCopy = {
  "saude-servicos": "Confira o estado, a latência e o detalhe de cada serviço, além das integrações Bling e Melhor Envio.",
  logs: "Pesquise eventos técnicos por nível, serviço, rota, usuário ou correlação; com permissão, registre a análise.",
  erros: "Consulte erros por rota, origem e correlação; com permissão, investigue, resolva ou ignore.",
  seguranca: "Consulte eventos de segurança com nível, usuário, correlação e IP anonimizado.",
  integracoes: "Acompanhe o estado, a latência e os erros das verificações de cada integração.",
  webhooks: "Consulte webhooks recebidos e a validade da assinatura; com permissão, reprocesse os que falharam.",
  filas: "Acompanhe jobs por fila e status; com permissão, reprocesse falhas ou cancele pendentes.",
  jobs: "Consulte a execução dos jobs, com tentativas, duração e erro; com permissão, reprocesse ou cancele.",
  falhas: "Revise jobs com falha; com permissão, reprocesse com justificativa.",
  "banco-dados": "Veja o diagnóstico agregado do banco, o estado dos serviços e os metadados de runtime.",
  supabase: "Confira o estado dos serviços e o diagnóstico agregado do banco.",
  storage: "Veja o total de arquivos e o tamanho de cada bucket, sem expor caminhos privados.",
  backups: "Confira a configuração de backups e os metadados de deploy da loja e do painel.",
  "auditoria-tecnica": "Consulte quem executou cada ação técnica, em qual recurso e com qual justificativa.",
  "integridade-dados": "Confira os totais de storage e o diagnóstico agregado do banco.",
  performance: "Analise métricas de duração por origem e rota, com os valores registrados.",
  deploys: "Confira ambiente, commit e build publicados na loja e no painel.",
  versoes: "Confira a versão em execução e os metadados de build da loja e do painel.",
  sessoes: "Entenda como a sessão técnica é validada e o que nunca é exposto no navegador.",
  "feature-flags": "Consulte as flags e os perfis atingidos; com permissão, ative ou desative com justificativa.",
  "configuracoes-tecnicas": "Revise serviços, integrações e configuração de runtime em um só lugar."
};
