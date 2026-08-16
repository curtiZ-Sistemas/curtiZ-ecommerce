export type HelpContent = {
  id: string;
  slug: string;
  type: string;
  title: string;
  summary: string;
  body: string;
  categoryName: string;
  categorySlug: string;
  keywords: string[];
  relatedAction?: { label: string; href: string };
  media?: Array<{ type: string; label: string; url: string }>;
  related?: Array<{ slug: string; title: string }>;
  feedbackEnabled?: boolean;
  version: number;
  updatedAt: string;
};

export const helpCategories = [
  { name: "Compras", slug: "compras" },
  { name: "Conta e cadastro", slug: "conta-cadastro" },
  { name: "Pedidos", slug: "pedidos" },
  { name: "Pagamentos", slug: "pagamentos" },
  { name: "Entregas e rastreamento", slug: "entregas-rastreamento" },
  { name: "Produtos e tamanhos", slug: "produtos-tamanhos" },
  { name: "Carrinho", slug: "carrinho" },
  { name: "Cupons", slug: "cupons" },
  { name: "Trocas e devoluções", slug: "trocas-devolucoes" },
  { name: "Cancelamentos", slug: "cancelamentos" },
  { name: "Avaliações", slug: "avaliacoes" },
  { name: "Segurança e privacidade", slug: "seguranca-privacidade" },
  { name: "Representante curti Z", slug: "representante-curtiz" },
  { name: "Kits", slug: "kits" },
  { name: "Comissões", slug: "comissoes" },
  { name: "Criativos", slug: "criativos" },
  { name: "Atendimento", slug: "atendimento" }
] as const;

const UPDATED_AT = "2026-08-16T00:00:00.000Z";

// Base editorial disponível antes da publicação de artigos adicionais no Supabase.
// O conteúdo descreve somente fluxos existentes e não simula integrações externas.
export const builtInHelpContents: HelpContent[] = [
  {
    id: "51000000-0000-0000-0000-000000000001",
    slug: "como-comprar",
    type: "step_by_step",
    title: "Como comprar na curti Z?",
    summary: "Do produto à confirmação, veja as etapas da compra.",
    body: "1. Escolha um produto no catálogo.\n2. Selecione a variante disponível.\n3. Adicione o item à sacola.\n4. Revise produtos e quantidades no carrinho.\n5. Entre na conta e confirme seus dados.\n6. Escolha ou cadastre o endereço de entrega.\n7. Consulte as opções de entrega disponíveis.\n8. Escolha uma forma de pagamento apresentada pelo checkout.\n9. Revise os dados e valores.\n10. Confirme a compra. O pedido aparecerá na sua conta quando for criado com sucesso.",
    categoryName: "Compras",
    categorySlug: "compras",
    keywords: ["comprar", "compra", "checkout", "sacola", "produto"],
    relatedAction: { label: "Explorar produtos", href: "/produtos" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000002",
    slug: "usar-carrinho",
    type: "tutorial",
    title: "Como usar o carrinho?",
    summary: "Revise variantes, quantidades e valores antes de continuar.",
    body: "Abra a sacola para conferir os itens escolhidos. Você pode ajustar a quantidade ou remover um produto antes de seguir. Estoque, preços, descontos e total são confirmados novamente pelo servidor durante a compra.",
    categoryName: "Carrinho",
    categorySlug: "carrinho",
    keywords: ["carrinho", "sacola", "quantidade", "remover", "total"],
    relatedAction: { label: "Abrir carrinho", href: "/carrinho" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000003",
    slug: "usar-cupom",
    type: "article",
    title: "Como usar um cupom?",
    summary: "Aplique um código válido no carrinho e confira o resultado.",
    body: "Quando o campo de cupom estiver disponível, informe o código no carrinho e selecione Aplicar. O desconto só será exibido se o cupom estiver ativo, for aplicável à compra e passar pela validação do servidor.",
    categoryName: "Cupons",
    categorySlug: "cupons",
    keywords: ["cupom", "código", "desconto", "aplicar"],
    relatedAction: { label: "Ir para o carrinho", href: "/carrinho" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000004",
    slug: "criar-e-acessar-conta",
    type: "step_by_step",
    title: "Como criar e acessar minha conta?",
    summary: "Cadastre seus dados ou entre em uma conta existente.",
    body: "Para criar uma conta, abra o cadastro, preencha os campos solicitados e siga as instruções exibidas. Se você já possui conta, use a tela de entrada. Nunca compartilhe sua senha ou códigos de segurança.",
    categoryName: "Conta e cadastro",
    categorySlug: "conta-cadastro",
    keywords: ["conta", "cadastro", "entrar", "login", "acesso"],
    relatedAction: { label: "Criar conta", href: "/cadastro" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000005",
    slug: "recuperar-acesso",
    type: "tutorial",
    title: "Como recuperar o acesso?",
    summary: "Use o fluxo seguro de recuperação se não conseguir entrar.",
    body: "Abra a tela de recuperação, informe o e-mail da conta e siga as orientações apresentadas. Por segurança, a tela não confirma se um endereço está cadastrado. Se o recurso estiver indisponível, use a Central de Ajuda.",
    categoryName: "Conta e cadastro",
    categorySlug: "conta-cadastro",
    keywords: ["senha", "recuperar", "acesso", "entrar", "e-mail"],
    relatedAction: { label: "Recuperar acesso", href: "/esqueci-senha" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000006",
    slug: "alterar-dados-e-enderecos",
    type: "tutorial",
    title: "Como alterar meus dados e endereços?",
    summary: "Mantenha as informações da conta atualizadas na área do cliente.",
    body: "Entre na sua conta e abra Perfil para revisar seus dados pessoais. Para endereços, use a seção Endereços. Confirme as alterações antes de sair e revise o endereço escolhido em cada nova compra.",
    categoryName: "Conta e cadastro",
    categorySlug: "conta-cadastro",
    keywords: ["perfil", "dados", "endereço", "conta", "editar"],
    relatedAction: { label: "Gerenciar perfil", href: "/minha-conta/perfil" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000007",
    slug: "acompanhar-pedido",
    type: "tutorial",
    title: "Como acompanhar um pedido?",
    summary: "Consulte os dados e eventos confirmados pelo servidor na sua conta.",
    body: "Entre na sua conta, abra Pedidos e selecione a compra desejada. A página mostra o status atual e as informações disponíveis. Quando houver rastreamento, a linha do tempo exibirá somente os eventos confirmados pelo servidor.",
    categoryName: "Pedidos",
    categorySlug: "pedidos",
    keywords: ["pedido", "status", "rastrear", "rastreamento", "entrega"],
    relatedAction: { label: "Ver meus pedidos", href: "/minha-conta/pedidos" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000008",
    slug: "cancelar-pedido",
    type: "article",
    title: "Como solicitar o cancelamento?",
    summary: "Consulte o pedido e use as ações disponíveis para o status atual.",
    body: "Abra o pedido na sua conta. Se o cancelamento estiver disponível para o status atual, a ação será exibida na página. Caso ela não apareça, fale com o atendimento e informe o pedido. Nenhuma alteração é feita sem confirmação do servidor.",
    categoryName: "Cancelamentos",
    categorySlug: "cancelamentos",
    keywords: ["pedido", "cancelar", "cancelamento", "status"],
    relatedAction: { label: "Consultar pedidos", href: "/minha-conta/pedidos" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000009",
    slug: "calculo-e-rastreamento-da-entrega",
    type: "article",
    title: "Como funcionam entrega e rastreamento?",
    summary: "Consulte opções no checkout e acompanhe informações confirmadas no pedido.",
    body: "As opções, valores e prazos disponíveis para seu endereço são apresentados durante a compra quando o cálculo de entrega estiver disponível. Depois da compra, abra o pedido na sua conta para consultar o status e o rastreamento, quando houver.",
    categoryName: "Entregas e rastreamento",
    categorySlug: "entregas-rastreamento",
    keywords: ["entrega", "frete", "prazo", "valor", "rastreio", "endereço"],
    relatedAction: { label: "Ver meus pedidos", href: "/minha-conta/pedidos" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000010",
    slug: "formas-de-pagamento",
    type: "article",
    title: "Quais formas de pagamento estão disponíveis?",
    summary: "O checkout mostra somente as opções habilitadas para a compra.",
    body: "As formas de pagamento disponíveis são apresentadas na etapa de pagamento do checkout. Revise o resumo antes de confirmar. Se nenhuma opção estiver disponível, a compra não será concluída nem tratada como paga.",
    categoryName: "Pagamentos",
    categorySlug: "pagamentos",
    keywords: ["pagamento", "checkout", "forma", "pagar", "total"],
    relatedAction: { label: "Ver política de pagamento", href: "/politicas/pagamento" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000011",
    slug: "solicitar-troca-ou-devolucao",
    type: "step_by_step",
    title: "Como solicitar troca ou devolução?",
    summary: "Inicie e acompanhe a solicitação pela sua conta.",
    body: "Entre na sua conta, abra Trocas e selecione a ação disponível. Informe o pedido e os dados solicitados. Depois do envio, acompanhe o status na mesma área. Consulte a política aplicável antes de iniciar.",
    categoryName: "Trocas e devoluções",
    categorySlug: "trocas-devolucoes",
    keywords: ["troca", "devolução", "pedido", "solicitação", "acompanhar"],
    relatedAction: { label: "Acessar trocas", href: "/minha-conta/trocas" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000012",
    slug: "proteger-conta",
    type: "article",
    title: "Como proteger minha conta?",
    summary: "Cuidados básicos para manter seus dados e seu acesso protegidos.",
    body: "Use uma senha exclusiva e nunca compartilhe senha, código de segurança, token ou dados completos de cartão em chamados. Revise os acessos na seção Segurança e ative a proteção adicional quando ela estiver disponível para sua conta.",
    categoryName: "Segurança e privacidade",
    categorySlug: "seguranca-privacidade",
    keywords: ["segurança", "senha", "privacidade", "mfa", "acesso", "conta"],
    relatedAction: { label: "Segurança da conta", href: "/minha-conta/seguranca" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000013",
    slug: "programa-de-representantes",
    type: "article",
    title: "Como funciona a área do representante?",
    summary: "Inscreva-se e acompanhe a análise sem perder sua conta de cliente.",
    body: "A solicitação é feita na área do programa e passa pela análise prevista no sistema. A situação pode ser acompanhada pela conta usada na inscrição. Quando o acesso profissional for autorizado, o Painel do Representante ficará disponível. Sua conta de cliente continua ativa para compras e atendimento.",
    categoryName: "Representante curti Z",
    categorySlug: "representante-curtiz",
    keywords: ["representante", "inscrição", "análise", "aprovação", "painel", "cliente"],
    relatedAction: { label: "Área do representante", href: "/representante" },
    version: 1,
    updatedAt: UPDATED_AT
  },
  {
    id: "51000000-0000-0000-0000-000000000014",
    slug: "abrir-chamado",
    type: "step_by_step",
    title: "Como falar com o atendimento?",
    summary: "Abra um chamado autenticado e acompanhe as respostas em um só lugar.",
    body: "Na Central de Ajuda, vá até Chamados e acompanhamento. Se ainda não estiver autenticado, entre na conta e retorne à Central. Informe assunto, categoria e descrição. Depois, acompanhe o status e o histórico no mesmo local.",
    categoryName: "Atendimento",
    categorySlug: "atendimento",
    keywords: ["atendimento", "chamado", "protocolo", "histórico", "resposta"],
    relatedAction: { label: "Abrir atendimento", href: "/minha-conta/atendimento?new=1" },
    version: 1,
    updatedAt: UPDATED_AT
  }
];

for (const content of builtInHelpContents) content.feedbackEnabled = false;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

export function searchBuiltInHelp(query: string, category?: string) {
  const normalizedQuery = normalize(query);
  const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
  return builtInHelpContents.filter((content) => {
    if (category && content.categorySlug !== category) return false;
    if (!terms.length) return true;
    const haystack = normalize(
      [
        content.title,
        content.summary,
        content.body,
        content.categoryName,
        ...content.keywords
      ].join(" ")
    );
    return terms.every((term) => {
      if (haystack.includes(term)) return true;
      if (term.length < 3) return false;
      const prefix = term.endsWith("s") ? term.slice(0, -1) : term;
      return haystack.split(/\s+/u).some((word) => word.startsWith(prefix));
    });
  });
}
