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
  version: number;
  updatedAt: string;
};

export const helpCategories = [
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
  { name: "Representante Curtiz", slug: "representante-curtiz" },
  { name: "Kits", slug: "kits" },
  { name: "Comissões", slug: "comissoes" },
  { name: "Criativos", slug: "criativos" },
  { name: "Atendimento", slug: "atendimento" }
] as const;

// Conteúdo de demonstração restrito a comportamentos que existem no sistema.
// Em ambientes reais, somente versões publicadas no Supabase são retornadas.
export const demoHelpContents: HelpContent[] = [
  {
    id: "51000000-0000-0000-0000-000000000001",
    slug: "acompanhar-pedido",
    type: "tutorial",
    title: "Como acompanhar um pedido?",
    summary: "Consulte os dados e eventos confirmados pelo servidor na sua conta.",
    body: "Entre na sua conta, abra Pedidos e selecione a compra desejada. Quando houver rastreamento disponível, a linha do tempo exibirá somente os eventos confirmados pelo servidor.",
    categoryName: "Pedidos",
    categorySlug: "pedidos",
    keywords: ["pedido", "rastrear", "rastreamento", "entrega"],
    relatedAction: { label: "Ver meus pedidos", href: "/minha-conta/pedidos" },
    version: 1,
    updatedAt: "2026-08-08T00:00:00.000Z"
  },
  {
    id: "51000000-0000-0000-0000-000000000002",
    slug: "abrir-chamado",
    type: "step_by_step",
    title: "Como falar com o atendimento?",
    summary: "Abra um chamado autenticado e acompanhe as respostas em um só lugar.",
    body: "Acesse a Central de Ajuda e escolha Falar com atendimento. Se ainda não estiver autenticado, você será direcionado ao login e retornará ao atendimento depois de entrar.",
    categoryName: "Atendimento",
    categorySlug: "atendimento",
    keywords: ["atendimento", "chamado", "protocolo", "humano"],
    relatedAction: { label: "Abrir atendimento", href: "/minha-conta/atendimento?new=1" },
    version: 1,
    updatedAt: "2026-08-08T00:00:00.000Z"
  },
  {
    id: "51000000-0000-0000-0000-000000000003",
    slug: "proteger-conta",
    type: "article",
    title: "Como proteger minha conta?",
    summary: "Cuidados básicos para manter o acesso protegido.",
    body: "Nunca compartilhe senha, código de segurança, token ou dados completos de cartão no chat ou em chamados. Use a recuperação de senha quando não conseguir entrar.",
    categoryName: "Segurança e privacidade",
    categorySlug: "seguranca-privacidade",
    keywords: ["segurança", "senha", "privacidade", "conta"],
    relatedAction: { label: "Recuperar senha", href: "/esqueci-senha" },
    version: 1,
    updatedAt: "2026-08-08T00:00:00.000Z"
  },
  {
    id: "51000000-0000-0000-0000-000000000004",
    slug: "central-representante",
    type: "article",
    title: "Onde acompanho minha solicitação de representante?",
    summary: "Use a área autenticada do programa para acompanhar sua solicitação.",
    body: "Entre na conta usada na solicitação e abra a área do representante. Regras, kits, metas e comissões são exibidos somente quando estiverem configurados e autorizados.",
    categoryName: "Representante Curtiz",
    categorySlug: "representante-curtiz",
    keywords: ["representante", "solicitação", "kit", "comissão"],
    relatedAction: { label: "Área do representante", href: "/representante" },
    version: 1,
    updatedAt: "2026-08-08T00:00:00.000Z"
  }
];

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

export function searchDemoHelp(query: string, category?: string) {
  const normalizedQuery = normalize(query);
  const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
  return demoHelpContents.filter((content) => {
    if (category && content.categorySlug !== category) return false;
    if (!terms.length) return true;
    const haystack = normalize(
      [content.title, content.summary, content.body, ...content.keywords].join(" ")
    );
    return terms.every(
      (term) =>
        haystack.includes(term) ||
        haystack.split(/\s+/u).some((word) => word.startsWith(term.slice(0, -1)))
    );
  });
}
