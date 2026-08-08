export type LocalHelpReply = {
  text: string;
  action?: { label: string; href: string };
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

export function localHelpReply(message: string): LocalHelpReply | null {
  const text = normalize(message);
  if (!text) return null;
  if (/^(oi|ola|bom dia|boa tarde|boa noite)( tudo bem)?$/u.test(text)) {
    return {
      text: "Olá! 👋 Como posso ajudar você hoje? Posso orientar sobre pedidos, trocas, pagamento, produtos ou sua conta."
    };
  }
  if (/^(preciso de ajuda|me ajuda|pode me ajudar|ajuda)$/u.test(text)) {
    return {
      text: "Claro. Escolha um assunto abaixo ou descreva sua dúvida. Se eu não encontrar uma resposta segura, encaminho você ao atendimento humano."
    };
  }
  if (/(onde|rastre|acompanhar|status).*(pedido|entrega)|(pedido|entrega).*(onde|rastre|acompanhar|status)/u.test(text)) {
    return {
      text: "Você pode acompanhar o status e o rastreamento confirmado na área Meus pedidos.",
      action: { label: "Ver meus pedidos", href: "/minha-conta/pedidos" }
    };
  }
  if (/troca|trocar|devolu|devolver/u.test(text)) {
    return {
      text: "Consulte as condições de troca e devolução. Se precisar analisar um pedido específico, abra um atendimento autenticado.",
      action: { label: "Ver trocas e devoluções", href: "/politicas/trocas-e-devolucoes" }
    };
  }
  if (/pagamento|pix|cartao|boleto/u.test(text)) {
    return {
      text: "As formas disponíveis e o estado do pagamento aparecem no checkout e nos detalhes do pedido.",
      action: { label: "Ver meus pedidos", href: "/minha-conta/pedidos" }
    };
  }
  if (/minha conta|login|senha|entrar|cadastro/u.test(text)) {
    return {
      text: "Na área da conta você pode consultar seus dados e pedidos. Se perdeu a senha, use a recuperação de acesso.",
      action: { label: "Abrir minha conta", href: "/minha-conta" }
    };
  }
  if (/produto|tamanho|cor|modelo|estoque/u.test(text)) {
    return {
      text: "Busque o produto e abra a página dele para conferir variações, tamanhos e disponibilidade atual.",
      action: { label: "Buscar produtos", href: "/produtos" }
    };
  }
  return null;
}
