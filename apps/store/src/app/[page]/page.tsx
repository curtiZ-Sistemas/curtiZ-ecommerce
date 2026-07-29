import { notFound } from "next/navigation";

const pages: Record<string, { title: string; lead: string; body: string[] }> = {
  sobre: {
    title: "Sobre a Curtiz",
    lead: "Conforto, estilo e escolhas feitas para a vida real.",
    body: [
      "A Curtiz é uma marca exclusivamente online de chinelos, slides e sandálias.",
      "Esta página usa conteúdo demonstrativo e poderá ser administrada pelo CMS interno."
    ]
  },
  contato: {
    title: "Fale com a Curtiz",
    lead: "Nossa central de ajuda reúne respostas rápidas e atendimento humano.",
    body: ["Para iniciar um atendimento com histórico, acesse a Central de ajuda."]
  },
  "trocas-e-devolucoes": {
    title: "Trocas e devoluções",
    lead: "Solicitações são analisadas por item, prazo e condição.",
    body: [
      "Nenhum produto retorna ao estoque vendável sem inspeção.",
      "Prazos e soluções aplicáveis são preservados no snapshot do pedido."
    ]
  },
  "formas-de-envio": {
    title: "Formas de envio",
    lead: "O frete é calculado conforme CEP, dimensões e disponibilidade do provedor.",
    body: ["Não oferecemos retirada em loja. Provedores não configurados nunca aparecem como online."]
  },
  "formas-de-pagamento": {
    title: "Formas de pagamento",
    lead: "Pagamento seguro com valores recalculados no servidor.",
    body: ["A integração prevista é o Checkout Pro do Mercado Pago. A Curtiz não armazena CVV."]
  },
  "politica-de-privacidade": {
    title: "Política de Privacidade",
    lead: "Tratamos somente os dados necessários e respeitamos suas escolhas.",
    body: [
      "Consentimento de marketing é separado e nunca vem marcado por padrão.",
      "Dados de pedidos sujeitos a retenção legal não são apagados sem análise."
    ]
  },
  "politica-de-cookies": {
    title: "Política de Cookies",
    lead: "Cookies essenciais mantêm autenticação, carrinho e segurança.",
    body: ["Analytics e marketing permanecem desativados até consentimento quando necessário."]
  },
  "termos-de-uso": {
    title: "Termos de Uso",
    lead: "Condições transparentes para uso da plataforma Curtiz.",
    body: ["A versão aceita dos termos é registrada junto ao consentimento."]
  },
  "rastrear-pedido": {
    title: "Rastrear pedido",
    lead: "Consulte eventos confirmados pelo provedor de frete.",
    body: ["Entre na sua conta para visualizar apenas seus próprios pedidos e rastreamentos."]
  },
  "esqueci-senha": {
    title: "Recuperar acesso",
    lead: "Informe seu e-mail para receber um link seguro.",
    body: ["A resposta será genérica para impedir enumeração de contas."]
  },
  "confirmar-email": {
    title: "Confirme seu e-mail",
    lead: "Use o link enviado pelo Supabase Auth.",
    body: ["Links possuem expiração e ações sensíveis exigem uma conta confirmada."]
  },
  "redefinir-senha": {
    title: "Definir nova senha",
    lead: "Escolha uma senha longa e exclusiva.",
    body: ["Após a alteração, você poderá encerrar as outras sessões."]
  },
  "403": {
    title: "Acesso não autorizado",
    lead: "Seu perfil não possui permissão para esta área.",
    body: ["A tentativa foi identificada e poderá ser auditada."]
  },
  manutencao: {
    title: "Estamos em manutenção",
    lead: "Voltaremos assim que as verificações forem concluídas.",
    body: ["Nenhum pedido será aceito enquanto o banco ou pagamento estiver indisponível."]
  },
  indisponivel: {
    title: "Serviço temporariamente indisponível",
    lead: "Preservamos seu carrinho para você tentar novamente.",
    body: ["Não inventamos cotações, pagamentos ou estados de integração."]
  }
};

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const page = pages[(await params).page];
  return page ? { title: page.title } : {};
}

export default async function ContentPage({ params }: { params: Promise<{ page: string }> }) {
  const page = pages[(await params).page];
  if (!page) notFound();
  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Curtiz</p>
          <h1>{page.title}</h1>
          <p>{page.lead}</p>
        </div>
      </div>
      <section className="form-card">
        {page.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
    </div>
  );
}
