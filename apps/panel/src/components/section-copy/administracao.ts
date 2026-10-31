import type { SectionCopy } from "./types";

// Descrição de uma linha por rota do painel, exibida abaixo do título no cabeçalho do shell.
// Dono: Agente 1. Rotas com cabeçalho próprio (produtos, recursos administrativos etc.) ignoram este texto.
export const administracaoSectionCopy: SectionCopy = {
  devolucoes: "Avalie solicitações, confira fotos, forneça orientações de postagem e acompanhe reembolsos autorizados.",
  representantes: "Acompanhe as solicitações e os cadastros de representantes.",
  criativos: "Crie, publique e arquive os materiais disponíveis no portal dos representantes.",
  "central-ajuda": "Mantenha os artigos e respostas exibidos na central de ajuda da loja.",
  politicas: "Edite, importe e publique as políticas e documentos legais da loja.",
  atendimentos: "Responda conversas de clientes e registre o andamento de cada atendimento."
};
