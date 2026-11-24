// Registro de ações pesquisáveis da barra "Buscar" (Ctrl K) do painel.
// Cada ação aponta para uma rota REAL de /app/[role]/[[...section]] e, quando a tela aceita,
// para um filtro por query string (`status` nas filas operacionais e de solicitações,
// `q` nas listas de produtos/gerência/técnico). Nada aqui chama a API: só leva ao lugar certo.
import type { PanelRouteRole } from "./panel-roles";
import { rankSearch, type Searchable } from "./search-engine";

export type SearchAction = Searchable & {
  panel: PanelRouteRole;
  href: string;
  /** Permissão do banco exigida pela tela; usada só para esconder a ação quando a capacidade é conhecida e negada. */
  permission?: string;
  area: string;
  description: string;
  keywords: readonly string[];
};

type Seed = {
  area: string;
  title: string;
  description: string;
  route: string;
  keywords: readonly string[];
  permission?: string;
};

const build = (panel: PanelRouteRole, seeds: readonly Seed[]): SearchAction[] =>
  seeds.map((seed) => ({
    id: `${panel}:${seed.route || "inicio"}:${seed.title}`,
    panel,
    area: seed.area,
    title: seed.title,
    description: seed.description,
    href: `/${panel}${seed.route ? `/${seed.route}` : ""}`,
    keywords: seed.keywords,
    ...(seed.permission ? { permission: seed.permission } : {})
  }));

// Sinônimos recorrentes, reaproveitados para manter as listas legíveis.
const approveWords = ["aprovar", "aprovacao", "liberar", "autorizar", "habilitar", "ativar", "confirmar", "validar"];
const pendingWords = ["pendente", "pendentes", "aguardando", "em analise", "fila", "solicitacao", "pedido de cadastro"];

const administracao = build("administracao", [
  // Catálogo
  {
    area: "Catálogo", title: "Cadastrar produto", route: "produtos", permission: "products.create",
    description: "Abra Produtos e use Cadastrar produto para criar um item novo com fotos, preço e variações.",
    keywords: ["criar produto", "novo produto", "adicionar produto", "incluir produto", "cadastro de produto", "subir produto", "publicar produto", "anunciar", "lancar produto", "cadastrar item", "novo item"]
  },
  {
    area: "Catálogo", title: "Editar produto, preço ou estoque", route: "produtos", permission: "products.update",
    description: "Encontre o produto na lista e altere nome, descrição, preço, fotos, variações e estoque.",
    keywords: ["editar produto", "alterar produto", "mudar preco", "alterar preco", "atualizar preco", "reajustar", "atualizar estoque", "trocar foto", "imagem do produto", "descricao do produto", "variacoes", "cor", "tamanho", "sku", "ajustar produto", "corrigir produto"]
  },
  {
    area: "Catálogo", title: "Importar produtos em lote", route: "produtos", permission: "products.create",
    description: "Importe vários produtos de uma vez a partir de planilha ou arquivo, com conferência antes de publicar.",
    keywords: ["importar", "importacao", "planilha", "csv", "excel", "em massa", "lote", "subir planilha", "carregar produtos", "importar catalogo", "bling"]
  },
  {
    area: "Catálogo", title: "Tabela de tamanhos e medidas", route: "produtos", permission: "products.update",
    description: "Edite a tabela de tamanhos exibida na página de cada produto.",
    keywords: ["guia de medidas", "tabela de medidas", "tamanhos", "medidas", "grade", "numeracao"]
  },
  {
    area: "Catálogo", title: "Duplicar produto", route: "produtos", permission: "products.create",
    description: "Crie um produto novo a partir de outro já cadastrado.",
    keywords: ["clonar produto", "copiar produto", "duplicar", "reaproveitar produto"]
  },
  {
    area: "Catálogo", title: "Arquivar ou tirar produto do ar", route: "produtos", permission: "products.archive",
    description: "Arquive, oculte ou despublique produtos que não devem aparecer na loja.",
    keywords: ["arquivar produto", "desativar produto", "tirar do ar", "ocultar produto", "despublicar", "pausar venda", "rascunho", "remover produto", "excluir produto", "apagar produto"]
  },
  {
    area: "Catálogo", title: "Produtos arquivados", route: "produtos-arquivados",
    description: "Veja os produtos arquivados e restaure os que voltarão a ser vendidos.",
    keywords: ["restaurar produto", "desarquivar", "reativar produto", "recuperar produto", "excluidos", "lixeira", "inativos", "voltar produto"]
  },
  {
    area: "Catálogo", title: "Categorias", route: "categorias", permission: "catalog.taxonomy.manage",
    description: "Crie, edite e organize as categorias e subcategorias da loja.",
    keywords: ["criar categoria", "nova categoria", "editar categoria", "subcategoria", "organizar categorias", "ordem das categorias", "departamento", "tipo de produto"]
  },
  {
    area: "Catálogo", title: "Navegação da loja (menu)", route: "navegacao-loja",
    description: "Monte o menu do cabeçalho da loja: categorias, ordem e links exibidos.",
    keywords: ["menu da loja", "menu", "cabecalho", "links do menu", "megamenu", "navegacao", "ordem do menu", "itens do menu", "rodape"]
  },
  {
    area: "Catálogo", title: "Coleções", route: "colecoes", permission: "catalog.taxonomy.manage",
    description: "Crie e edite coleções de produtos, como lançamentos e campanhas sazonais.",
    keywords: ["criar colecao", "nova colecao", "lancamentos", "agrupar produtos", "vitrine", "colecao de verao", "sazonal"]
  },
  // Vendas
  {
    area: "Vendas", title: "Pedidos", route: "pedidos", permission: "orders.read_all",
    description: "Consulte os pedidos, o pagamento e a situação de cada um. Alterações de status seguem o fluxo operacional.",
    keywords: ["ver pedidos", "consultar pedido", "buscar pedido", "pedido pago", "pagamento do pedido", "status do pedido", "pagar pedido", "enviar pedido", "compras", "vendas da loja", "numero do pedido"]
  },
  {
    area: "Vendas", title: "Clientes", route: "clientes", permission: "users.read",
    description: "Consulte os cadastros de clientes e a situação de cada conta.",
    keywords: ["cadastro de cliente", "buscar cliente", "consultar cliente", "email do cliente", "compradores", "consumidores", "contas de clientes"]
  },
  {
    area: "Vendas", title: "Trocas e devoluções", route: "devolucoes", permission: "returns.read",
    description: "Avalie solicitações, confira fotos, oriente a postagem e acompanhe os reembolsos autorizados.",
    keywords: ["devolver pedido", "devolucao", "troca", "trocar produto", "retorno", "logistica reversa", "postagem reversa", "arrependimento", "defeito"]
  },
  {
    area: "Vendas", title: "Devoluções aguardando análise", route: "devolucoes?status=requested", permission: "returns.approve",
    description: "Solicitações novas de troca ou devolução que ainda precisam ser aprovadas ou recusadas.",
    keywords: ["aprovar devolucao", "aprovar troca", "recusar devolucao", "rejeitar devolucao", "devolucao pendente", "troca pendente", "analisar devolucao", "solicitacao de devolucao", "nova devolucao"]
  },
  {
    area: "Vendas", title: "Reembolsar pedido ou devolução", route: "devolucoes?status=refund_requested", permission: "returns.refund",
    description: "Reembolsos solicitados e aguardando confirmação do estorno ao cliente.",
    keywords: ["reembolso", "reembolsar", "estorno", "estornar", "devolver dinheiro", "devolver pagamento", "pedido reembolso", "reembolso pendente", "cancelar e reembolsar", "pix de volta", "cartao estorno"]
  },
  {
    area: "Vendas", title: "Atendimentos de clientes", route: "atendimentos", permission: "support.conversations.read",
    description: "Responda conversas de clientes e registre o andamento de cada atendimento.",
    keywords: ["suporte", "chat", "ticket", "reclamacao", "duvida de cliente", "responder cliente", "mensagens", "sac", "fale conosco"]
  },
  // Marketing e conteúdo
  {
    area: "Marketing", title: "Cupons de desconto", route: "cupons", permission: "promotions.advanced_manage",
    description: "Crie e gerencie cupons: tipo, valor, validade, limite de uso e combinação.",
    keywords: ["criar cupom", "novo cupom", "codigo promocional", "codigo de desconto", "desconto", "promocao", "frete gratis cupom", "validade do cupom", "voucher", "cupom de boas-vindas"]
  },
  {
    area: "Marketing", title: "Banners", route: "banners", permission: "banners.update",
    description: "Troque, agende e publique os banners exibidos na loja.",
    keywords: ["trocar banner", "novo banner", "carrossel", "hero", "imagem principal", "destaque da home", "agendar banner", "publicar banner", "slide"]
  },
  {
    area: "Marketing", title: "Construtor da página inicial", route: "construtor-home",
    description: "Monte a página inicial da loja: seções, vitrines, mídias e ordem de exibição.",
    keywords: ["editar home", "pagina inicial", "home da loja", "secoes da home", "vitrine da home", "layout da home", "mudar pagina inicial", "videos da home", "midias da home", "versoes da home"]
  },
  {
    area: "Marketing", title: "Barra promocional", route: "barra-promocional",
    description: "Edite a mensagem da faixa promocional exibida no topo da loja.",
    keywords: ["faixa do topo", "aviso no topo", "mensagem promocional", "frete gratis aviso", "anuncio do topo", "texto do topo", "topbar"]
  },
  {
    area: "Marketing", title: "Conteúdo da loja", route: "conteudo", permission: "content.manage",
    description: "Gerencie textos e blocos de conteúdo usados nas páginas da loja.",
    keywords: ["textos da loja", "paginas institucionais", "sobre nos", "blocos de conteudo", "editar texto", "blog"]
  },
  {
    area: "Marketing", title: "Marketing", route: "marketing", permission: "content.manage",
    description: "Configure ações de marketing da loja.",
    keywords: ["divulgacao", "email marketing", "newsletter", "seo", "redes sociais", "pixel", "analytics"]
  },
  {
    area: "Marketing", title: "Campanhas", route: "campanhas", permission: "creatives.manage",
    description: "Crie e acompanhe as campanhas de divulgação da rede e da loja.",
    keywords: ["criar campanha", "nova campanha", "campanha de vendas", "acao promocional", "lancar campanha"]
  },
  {
    area: "Marketing", title: "Avaliações de clientes", route: "avaliacoes", permission: "reviews.manage",
    description: "Modere as avaliações dos produtos: aprove, oculte ou responda.",
    keywords: ["moderar avaliacao", "aprovar avaliacao", "comentarios", "reviews", "estrelas", "opiniao de cliente", "ocultar avaliacao", "responder avaliacao"]
  },
  {
    area: "Marketing", title: "Central de Ajuda", route: "central-ajuda",
    description: "Mantenha os artigos e respostas exibidos na central de ajuda da loja.",
    keywords: ["faq", "perguntas frequentes", "artigos de ajuda", "editar ajuda", "duvidas", "tutorial"]
  },
  // Representantes
  {
    area: "Representantes", title: "Aprovar solicitações de representantes", route: "representantes?status=pendentes", permission: "representatives.manage",
    description: "Abre a fila já filtrada nas solicitações pendentes: inicie a análise, aprove, peça correção ou rejeite.",
    keywords: [
      "ativar representante", "ativar conta de representante", "liberar conta", "liberar representante", "aprovar representante", "habilitar representante", "habilitar conta",
      "solicitacao de representante", "solicitacoes pendentes", "pedido para ser representante", "quem pediu para ser representante", "novo representante", "cadastro de representante",
      "candidata", "candidato a representante", "analisar cadastro", "iniciar analise", "rejeitar representante", "recusar representante", "pedir correcao",
      ...approveWords.map((word) => `${word} representante`), ...pendingWords.map((word) => `${word} representante`)
    ]
  },
  {
    area: "Representantes", title: "Solicitações com correção solicitada", route: "representantes?status=documents_pending",
    description: "Solicitações devolvidas para a candidata corrigir documentos ou dados.",
    keywords: ["documentos pendentes", "correcao solicitada", "falta documento", "cadastro incompleto", "representante com pendencia"]
  },
  {
    area: "Representantes", title: "Solicitações e cadastros de representantes", route: "representantes", permission: "representatives.read_all",
    description: "Todas as solicitações e cadastros de representantes, em qualquer situação.",
    keywords: ["lista de representantes", "revendedoras", "revendedor", "rede", "equipe comercial", "representantes aprovadas", "consultar representante", "buscar representante"]
  },
  {
    area: "Representantes", title: "Kits de representantes", route: "kits", permission: "representatives.read_all",
    description: "Gerencie os kits, a linha de estoque vinculada e os preços por ficha.",
    keywords: ["criar kit", "editar kit", "preco do kit", "kit inicial", "kit de ativacao", "kit obrigatorio", "grade do kit", "ficha do kit", "estoque proprio", "pacote inicial", "kit mg"]
  },
  {
    area: "Fiscal", title: "Emitir nota de atacado", route: "notas-atacado", permission: "fiscal.wholesale_invoices.issue",
    description: "Emita a NF-e de um kit para uma empresa de MG: escolha a ficha, informe o CNPJ e o pagamento.",
    keywords: ["emitir nota", "nota de atacado", "nfe de atacado", "vender kit", "venda de atacado", "nota para empresa", "cnpj", "emitir nfe", "nota fiscal do kit", "atacado"]
  },
  {
    area: "Representantes", title: "Níveis da rede", route: "niveis", permission: "representatives.read_all",
    description: "Configure os níveis de progressão das representantes e seus critérios.",
    keywords: ["nivel de representante", "criar nivel", "progressao", "bronze", "prata", "ouro", "criterios de nivel", "promover representante", "subir de nivel"]
  },
  {
    area: "Representantes", title: "Metas", route: "metas", permission: "representatives.read_all",
    description: "Defina e ajuste metas por representante ou por nível.",
    keywords: ["definir meta", "criar meta", "meta de vendas", "objetivo", "meta mensal", "bonus por meta", "metas da rede"]
  },
  {
    area: "Representantes", title: "Comissões autorizadas", route: "comissoes", permission: "representatives.commissions.read_all",
    description: "Consulte as comissões calculadas, com base, valor e situação.",
    keywords: ["comissao", "comissoes", "percentual de comissao", "ganhos da representante", "valor a pagar", "extrato de comissao", "autorizar comissao"]
  },
  {
    area: "Representantes", title: "Contratos da rede", route: "contratos", permission: "representatives.read_all",
    description: "Acompanhe os contratos aceitos pelas representantes e suas versões.",
    keywords: ["contrato de representante", "termo aceito", "aceite", "versao do contrato", "assinatura"]
  },
  {
    area: "Representantes", title: "Criativos para representantes", route: "criativos", permission: "creatives.manage",
    description: "Crie, publique e arquive os materiais disponíveis no portal das representantes.",
    keywords: ["materiais de divulgacao", "artes", "imagens para divulgar", "material de marketing", "publicar criativo", "aprovar criativo", "arquivo para representantes"]
  },
  {
    area: "Representantes", title: "Treinamentos", route: "treinamentos", permission: "training.manage",
    description: "Cadastre e organize os treinamentos exibidos às representantes.",
    keywords: ["curso", "aulas", "video aula", "capacitacao", "material de treinamento", "onboarding"]
  },
  // Governança
  {
    area: "Governança", title: "Usuários do painel", route: "usuarios", permission: "users.read",
    description: "Consulte e gerencie as pessoas com acesso ao painel e seus papéis.",
    keywords: ["criar usuario", "novo usuario", "convidar usuario", "funcionario", "equipe interna", "acesso ao painel", "bloquear usuario", "desativar usuario", "cargo", "papel"]
  },
  {
    area: "Governança", title: "Permissões de acesso", route: "permissoes", permission: "users.read",
    description: "Veja e ajuste as permissões de cada papel do painel.",
    keywords: ["permissao", "dar acesso", "remover acesso", "perfil de acesso", "o que cada pessoa pode fazer", "papeis", "autorizacao"]
  },
  {
    area: "Governança", title: "Privacidade e LGPD: solicitações de titulares", route: "politicas", permission: "privacy.requests.manage",
    description: "Na Central de políticas, atenda pedidos de titulares: acesso, correção, exclusão e portabilidade de dados.",
    keywords: ["lgpd", "privacidade", "dados pessoais", "excluir meus dados", "exportar dados", "apagar dados", "titular", "direito do titular", "consentimento", "canal de privacidade", "dpo", "pedido de exclusao"]
  },
  {
    area: "Governança", title: "Políticas e documentos legais", route: "politicas",
    description: "Edite, importe e publique as políticas e documentos legais da loja.",
    keywords: ["termos de uso", "politica de privacidade", "politica de troca", "politica de frete", "termos", "documentos legais", "juridico", "publicar politica", "importar politica", "regulamento"]
  }
]);

const operacional = build("operacional", [
  // Pedidos por situação
  {
    area: "Pedidos", title: "Pedidos", route: "pedidos", permission: "orders.read_assigned",
    description: "Busque pedidos, confira entrega e itens, inicie a separação ou a expedição e acompanhe o Bling.",
    keywords: ["ver pedidos", "buscar pedido", "consultar pedido", "numero do pedido", "fila de pedidos", "compras", "bling", "pedido no bling"]
  },
  {
    area: "Pedidos", title: "Pedidos pagos para separar", route: "pedidos?status=payment_approved", permission: "orders.update_operational_status",
    description: "Pedidos com pagamento aprovado, prontos para iniciar a separação.",
    keywords: ["pagamento aprovado", "pedido pago", "pagar pedido", "iniciar separacao", "separar pedido", "novos pedidos", "pedidos novos", "pedidos pendentes de separacao", "liberar pedido"]
  },
  {
    area: "Pedidos", title: "Pedidos em separação", route: "pedidos?status=picking",
    description: "Pedidos que estão sendo separados agora.",
    keywords: ["separando", "em separacao", "picking", "conferir itens", "pedidos em andamento"]
  },
  {
    area: "Pedidos", title: "Pedidos prontos para enviar", route: "pedidos?status=ready_to_ship", permission: "orders.update_operational_status",
    description: "Pedidos embalados e aguardando despacho ou coleta.",
    keywords: ["enviar pedido", "despachar", "pronto para envio", "expedir", "postar", "mandar pedido", "gerar etiqueta", "embalado", "aguardando coleta"]
  },
  {
    area: "Pedidos", title: "Pedidos enviados", route: "pedidos?status=shipped",
    description: "Pedidos já despachados, com código de rastreio.",
    keywords: ["enviado", "rastreio", "rastrear pedido", "codigo de rastreamento", "correios", "transportadora", "em transito", "tracking"]
  },
  {
    area: "Pedidos", title: "Pedidos em revisão manual", route: "pedidos?status=manual_review",
    description: "Pedidos bloqueados que precisam de decisão antes de seguir.",
    keywords: ["revisao manual", "pedido bloqueado", "pedido travado", "pedido parado", "antifraude", "conferir pedido", "divergencia"]
  },
  {
    area: "Pedidos", title: "Pedidos cancelados", route: "pedidos?status=cancelled",
    description: "Pedidos cancelados, para conferência.",
    keywords: ["cancelado", "cancelamento", "pedido cancelado", "cancelar pedido"]
  },
  {
    area: "Pedidos", title: "Pedidos reembolsados", route: "pedidos?status=refunded",
    description: "Pedidos que já tiveram o valor devolvido ao cliente.",
    keywords: ["reembolso", "reembolsado", "estornado", "pedido reembolso", "dinheiro devolvido", "estorno concluido"]
  },
  {
    area: "Pedidos", title: "Pendências: reembolso e cancelamento", route: "pendencias", permission: "orders.read_assigned",
    description: "Pedidos bloqueados, reembolsos e cancelamentos a decidir, tarefas abertas e pendências do Bling.",
    keywords: ["pendencia", "reembolso pendente", "cancelamento solicitado", "o que esta atrasado", "tarefas abertas", "bloqueios", "pedido para resolver", "bling pendente", "alertas"]
  },
  // Separação e envio
  {
    area: "Expedição", title: "Separação", route: "separacao", permission: "orders.update_operational_status",
    description: "Assuma tarefas de separação, confira cada item e registre divergências antes de concluir.",
    keywords: ["separar", "picking", "conferencia de itens", "divergencia de separacao", "assumir tarefa", "lista de separacao"]
  },
  {
    area: "Expedição", title: "Expedição", route: "expedicao", permission: "orders.update_operational_status",
    description: "Assuma tarefas de expedição, confira os itens e conclua a conferência antes do despacho.",
    keywords: ["expedir", "despacho", "conferir antes de enviar", "embalagem", "romaneio", "coleta"]
  },
  {
    area: "Expedição", title: "Envio e remessas", route: "envio", permission: "orders.update_operational_status",
    description: "Assuma tarefas de envio, confira os itens e conclua a conferência de cada remessa.",
    keywords: ["etiqueta", "frete", "melhor envio", "correios", "postar pedido", "remessa", "codigo de rastreio", "enviar encomenda"]
  },
  // Estoque
  {
    area: "Estoque", title: "Estoque", route: "estoque", permission: "inventory.adjust",
    description: "Consulte saldo, reservas, danos e mínimo de cada variação e solicite ajustes para aprovação.",
    keywords: ["saldo", "quantidade em estoque", "ajustar estoque", "solicitar ajuste", "inventario", "contagem", "movimentacao de estoque", "sku", "reservado", "baixa de estoque", "entrada de estoque"]
  },
  {
    area: "Estoque", title: "Reposição de estoque", route: "reposicao", permission: "inventory.adjust",
    description: "Variações em estoque crítico, com movimentações recentes e ajustes solicitados.",
    keywords: ["repor estoque", "estoque baixo", "estoque critico", "acabando", "minimo", "comprar mais", "sem estoque", "ruptura"]
  },
  {
    area: "Estoque", title: "Produtos danificados", route: "danificados", permission: "inventory.adjust",
    description: "Variações com unidades danificadas; solicite ajustes para aprovação quando necessário.",
    keywords: ["avaria", "defeito", "quebrado", "produto com defeito", "dano", "descarte", "baixa por dano", "estoque danificado"]
  },
  // Kits MG
  {
    area: "Kits de representantes", title: "Entregas de kits MG", route: "kits", permission: "representatives.kits.fulfill",
    description: "Kits de representantes para montagem e conferência; agendamento de coleta, entrega própria, rotas e recebimento.",
    keywords: ["entrega de kit", "entregas dos kits", "rota de entrega", "entrega propria", "coleta de kit", "retirada de kit", "pedido de kit", "mdfe", "mdf-e", "kit mg", "kit de representante", "recebimento do kit"]
  },
  {
    area: "Kits de representantes", title: "Montagem de kits", route: "montagem-kits", permission: "representatives.kits.fulfill",
    description: "Inicie a montagem dos kits pagos ou em separação e acompanhe o status de cada um.",
    keywords: ["montar kit", "montagem", "separar kit", "kit pago", "preparar kit", "conferir kit"]
  },
  // Fiscal
  {
    area: "Fiscal", title: "Notas fiscais e NF-e", route: "notas-fiscais", permission: "orders.read_assigned",
    description: "Acompanhe status, referência e tentativas das notas fiscais dos pedidos e dos kits MG.",
    keywords: ["nota fiscal", "nfe", "nf-e", "emitir nota", "danfe", "bling nota", "fiscal", "chave da nota", "xml", "nota rejeitada", "nota pendente", "serie 003", "serie 004"]
  },
  {
    area: "Fiscal", title: "Reemitir NF-e de kit com erro", route: "notas-fiscais", permission: "representatives.kits.fulfill",
    description: "Na fila de notas dos kits, use \"Reemitir\" no pedido marcado como NF-e com erro.",
    keywords: ["reemitir", "reemitir nota", "reemitir nfe", "reenviar nota", "emitir de novo", "tentar novamente nota", "nota com erro", "nfe com erro", "erro na nota", "nota do kit", "nota automatica", "falha na nota"]
  },
  {
    area: "Fiscal", title: "Enviar NF-e emitida manualmente (kits MG)", route: "notas-fiscais", permission: "representatives.kits.fulfill",
    description: "Informe o ID e a chave da NF-e emitida à mão no Bling para validar o pedido de kit.",
    keywords: ["nfe manual", "nota manual", "nf-e manual", "emitida manualmente", "validar nfe", "chave da nfe", "id da nfe no bling", "enviar nota para validacao", "nota fiscal do kit", "emissao fiscal manual", "serie 003"]
  },
  // Pós-venda
  {
    area: "Pós-venda", title: "Trocas", route: "trocas", permission: "returns.inspect",
    description: "Acompanhe as trocas autorizadas, a postagem e o recebimento; registre a inspeção física dos itens.",
    keywords: ["trocar produto", "troca de tamanho", "troca de cor", "enviar troca", "inspecao", "recebimento da troca"]
  },
  {
    area: "Pós-venda", title: "Devoluções", route: "devolucoes", permission: "returns.inspect",
    description: "Acompanhe orientações, postagem, recebimento e inspeção. Aprovação e reembolso exigem permissão de administração ou gerência.",
    keywords: ["devolver pedido", "devolucao", "receber devolucao", "inspecionar devolucao", "retorno de mercadoria", "logistica reversa", "devolucao de kit", "nota de devolucao"]
  },
  {
    area: "Pós-venda", title: "Reembolsos solicitados", route: "devolucoes?status=refund_requested", permission: "returns.refund",
    description: "Devoluções com reembolso solicitado, aguardando decisão de quem tem permissão financeira.",
    keywords: ["reembolso", "reembolsar", "estorno", "pedido reembolso", "devolver dinheiro", "reembolso pendente"]
  },
  {
    area: "Pós-venda", title: "Devoluções recebidas para inspeção", route: "devolucoes?status=received", permission: "returns.inspect",
    description: "Pacotes de devolução já recebidos que aguardam a conferência dos itens.",
    keywords: ["inspecionar", "conferir devolucao", "devolucao recebida", "chegou devolucao", "restocar", "voltar ao estoque", "retornar ao estoque"]
  },
  {
    area: "Pós-venda", title: "Ocorrências", route: "ocorrencias",
    description: "Registre divergências, danos e problemas de envio e acompanhe a resolução de cada ocorrência.",
    keywords: ["registrar ocorrencia", "nova ocorrencia", "problema", "extravio", "item faltando", "divergencia", "reclamacao interna", "resolver ocorrencia"]
  },
  // Atendimento e conteúdo
  {
    area: "Atendimento", title: "Atendimento atribuído", route: "atendimentos", permission: "support.conversations.read",
    description: "Responda os atendimentos transferidos para você e registre a resolução de cada conversa.",
    keywords: ["suporte", "chat", "responder cliente", "ticket", "conversas", "mensagens", "sac"]
  },
  {
    area: "Atendimento", title: "Central de Ajuda", route: "central-ajuda",
    description: "Consulte os artigos da Central de Ajuda.",
    keywords: ["faq", "perguntas frequentes", "tutorial", "como fazer", "duvidas"]
  },
  {
    area: "Conteúdo", title: "Mídias da página inicial", route: "construtor-home",
    description: "Atualize as mídias exibidas na página inicial da loja.",
    keywords: ["home", "video da home", "imagens da home", "pagina inicial", "banner da home"]
  },
  // Gestão
  {
    area: "Gestão", title: "Representantes (consulta)", route: "representantes", permission: "representatives.read_all",
    description: "Consulte representantes e seus pedidos de kit na operação.",
    keywords: ["revendedoras", "lista de representantes", "buscar representante", "codigo da representante", "rede"]
  },
  {
    area: "Gestão", title: "Relatórios operacionais", route: "relatorios-operacionais",
    description: "Contagens atuais de cada fila operacional, sem valores financeiros.",
    keywords: ["relatorio", "indicadores", "quantos pedidos", "filas", "painel de numeros", "resumo da operacao"]
  },
  {
    area: "Gestão", title: "Políticas oficiais", route: "politicas",
    description: "Consulte e compartilhe as políticas publicadas e vigentes da loja.",
    keywords: ["politica de troca", "politica de frete", "termos", "regras da loja", "privacidade", "lgpd"]
  }
]);

const gerencia = build("gerencia", [
  // Resultados
  {
    area: "Resultados", title: "Visão estratégica", route: "visao-estrategica",
    description: "Compare faturamento, lucro e pedidos com o período anterior e veja produtos, categorias, regiões e metas.",
    keywords: ["faturamento", "lucro", "margem", "resultado", "comparar periodo", "crescimento", "indicadores", "kpi", "mais vendidos", "melhor produto", "regioes"]
  },
  {
    area: "Resultados", title: "Pedidos e vendas", route: "pedidos-vendas", permission: "orders.read_all",
    description: "Acompanhe pedidos, pagamentos e resultado disponível por período.",
    keywords: ["vendas", "relatorio de vendas", "ver pedidos", "buscar pedido", "lucro por pedido", "ticket medio", "pedido pago", "pedido enviado", "pagamentos de pedidos", "status do pedido"]
  },
  {
    area: "Resultados", title: "Inteligência da loja", route: "inteligencia-loja",
    description: "Veja visualizações, favoritos, carrinhos e buscas agregadas para decidir catálogo e descoberta.",
    keywords: ["carrinho abandonado", "favoritos", "o que buscam", "buscas dos clientes", "visualizacoes", "funil", "conversao", "analytics"]
  },
  {
    area: "Resultados", title: "Clientes", route: "clientes", permission: "users.read",
    description: "Consulte os cadastros de clientes limitados aos dados necessários para análise.",
    keywords: ["cadastro de cliente", "buscar cliente", "compradores", "base de clientes", "consumidores"]
  },
  // Representantes
  {
    area: "Representantes", title: "Aprovar solicitações de representantes", route: "solicitacoes-representantes?status=pendentes", permission: "representatives.manage",
    description: "Abre a fila já filtrada nas solicitações pendentes: inicie a análise, aprove, peça correção ou rejeite.",
    keywords: [
      "ativar representante", "ativar conta de representante", "liberar conta", "liberar representante", "aprovar representante", "habilitar representante", "habilitar conta",
      "solicitacao de representante", "solicitacoes pendentes", "pedido para ser representante", "quem pediu para ser representante", "novo representante", "cadastro de representante",
      "candidata", "candidato a representante", "analisar cadastro", "iniciar analise", "rejeitar representante", "recusar representante", "pedir correcao",
      ...approveWords.map((word) => `${word} representante`), ...pendingWords.map((word) => `${word} representante`)
    ]
  },
  {
    area: "Representantes", title: "Solicitações com correção solicitada", route: "solicitacoes-representantes?status=documents_pending",
    description: "Solicitações devolvidas para a candidata corrigir documentos ou dados.",
    keywords: ["documentos pendentes", "correcao solicitada", "falta documento", "cadastro incompleto", "representante com pendencia"]
  },
  {
    area: "Representantes", title: "Todas as solicitações de representantes", route: "solicitacoes-representantes", permission: "representatives.read_all",
    description: "Histórico completo de solicitações, em qualquer situação.",
    keywords: ["solicitacoes", "pedidos de cadastro", "candidatas", "historico de solicitacoes", "aprovadas", "rejeitadas"]
  },
  {
    area: "Representantes", title: "Rede de representantes", route: "representantes", permission: "representatives.read_all",
    description: "Consulte situação, nível e região da rede; suspensões e reativações exigem justificativa.",
    keywords: ["suspender representante", "reativar representante", "bloquear representante", "desativar representante", "lista de representantes", "revendedoras", "buscar representante", "regiao", "nivel da representante"]
  },
  {
    area: "Representantes", title: "Rede de indicações", route: "rede-indicacoes", permission: "representatives.read_all",
    description: "Consulte a estrutura de indicações registrada entre representantes.",
    keywords: ["indicacao", "quem indicou", "arvore de indicacoes", "equipe da representante", "link de indicacao", "downline"]
  },
  {
    area: "Representantes", title: "Níveis", route: "niveis", permission: "representatives.read_all",
    description: "Consulte e ajuste a configuração de progressão da rede.",
    keywords: ["nivel de representante", "criar nivel", "progressao", "criterios de nivel", "promover representante"]
  },
  {
    area: "Representantes", title: "Qualificação", route: "qualificacao", permission: "representatives.read_all",
    description: "Consulte os resultados das regras de qualificação por período.",
    keywords: ["qualificada", "qualificacao mensal", "quem se qualificou", "requisitos", "elegibilidade"]
  },
  {
    area: "Representantes", title: "Metas", route: "metas", permission: "representatives.read_all",
    description: "Consulte e ajuste as metas individuais ou por nível.",
    keywords: ["definir meta", "criar meta", "meta de vendas", "objetivo", "meta mensal", "bonus por meta"]
  },
  {
    area: "Representantes", title: "Kits de representantes", route: "kits", permission: "representatives.read_all",
    description: "Kits da rede: catálogo, preços por ficha e acompanhamento.",
    keywords: ["criar kit", "editar kit", "preco do kit", "pedido de kit", "pedidos de kit", "kit inicial", "estoque proprio", "kit mg", "entrega de kit"]
  },
  {
    area: "Fiscal", title: "Emitir nota de atacado", route: "notas-atacado", permission: "fiscal.wholesale_invoices.issue",
    description: "Emita a NF-e de um kit para uma empresa de MG: escolha a ficha, informe o CNPJ e o pagamento.",
    keywords: ["emitir nota", "nota de atacado", "nfe de atacado", "vender kit", "venda de atacado", "nota para empresa", "cnpj", "emitir nfe", "nota fiscal do kit", "atacado"]
  },
  // Financeiro
  {
    area: "Financeiro", title: "Controle financeiro", route: "financeiro",
    description: "Acompanhe caixa, contas a receber e a pagar, lançamentos e aportes do período.",
    keywords: ["fluxo de caixa", "caixa", "contas a pagar", "contas a receber", "despesa", "receita", "lancamento", "aporte", "custos", "saldo", "financas", "dinheiro", "pagar conta", "registrar despesa"]
  },
  {
    area: "Financeiro", title: "Comissões", route: "comissoes", permission: "representatives.commissions.read_all",
    description: "Consulte as comissões calculadas, com base, valor e situação.",
    keywords: ["comissao", "comissoes", "ganhos das representantes", "valor a pagar", "extrato de comissao", "autorizar comissao"]
  },
  {
    area: "Financeiro", title: "Regras de comissão", route: "regras-comissao", permission: "representatives.rules.manage",
    description: "Consulte e ajuste as regras usadas no cálculo das comissões.",
    keywords: ["percentual de comissao", "alterar comissao", "regra de comissao", "taxa", "calculo de comissao", "porcentagem"]
  },
  {
    area: "Financeiro", title: "Fechamentos de comissão", route: "fechamentos", permission: "representatives.commissions.close",
    description: "Simule, aprove, bloqueie ou reabra fechamentos de comissão com registro em auditoria.",
    keywords: ["fechar mes", "fechamento", "aprovar fechamento", "reabrir fechamento", "bloquear fechamento", "fechar comissoes", "ciclo", "periodo de comissao"]
  },
  {
    area: "Financeiro", title: "Pagamentos de comissão", route: "pagamentos", permission: "representatives.commissions.read_all",
    description: "Consulte os pagamentos de comissão efetivamente registrados.",
    keywords: ["pagar representante", "pagamento de comissao", "repasse", "pix para representante", "comprovante", "historico de pagamentos"]
  },
  {
    area: "Financeiro", title: "Simulações de fechamento", route: "simulacoes", permission: "representatives.commissions.close",
    description: "Simule fechamentos de comissão por período antes de enviá-los para aprovação.",
    keywords: ["simular fechamento", "simular comissao", "previa de pagamento", "projecao", "cenario"]
  },
  {
    area: "Financeiro", title: "Reembolsar pedido ou devolução", route: "devolucoes?status=refund_requested", permission: "returns.refund",
    description: "Reembolsos solicitados e aguardando autorização e confirmação do estorno.",
    keywords: ["reembolso", "reembolsar", "estorno", "estornar", "pedido reembolso", "autorizar reembolso", "devolver dinheiro", "reembolso pendente", "pix de volta"]
  },
  {
    area: "Financeiro", title: "Trocas e devoluções", route: "devolucoes", permission: "returns.read",
    description: "Avalie trocas e devoluções, autorize reembolsos e acompanhe confirmações e conciliações.",
    keywords: ["devolver pedido", "devolucao", "troca", "aprovar devolucao", "recusar devolucao", "conciliar reembolso", "logistica reversa"]
  },
  // Conteúdo
  {
    area: "Conteúdo", title: "Criativos da rede", route: "criativos", permission: "creatives.approve",
    description: "Revise os criativos enviados pela rede e registre a decisão.",
    keywords: ["aprovar criativo", "reprovar criativo", "materiais de divulgacao", "artes", "revisar material", "publicar criativo"]
  },
  {
    area: "Conteúdo", title: "Campanhas", route: "campanhas", permission: "creatives.manage",
    description: "Consulte as campanhas e altere o estado de aprovação e publicação com justificativa.",
    keywords: ["aprovar campanha", "publicar campanha", "pausar campanha", "campanha de vendas", "acao promocional"]
  },
  {
    area: "Conteúdo", title: "Barra promocional", route: "barra-promocional",
    description: "Edite a mensagem da barra promocional exibida na loja.",
    keywords: ["faixa do topo", "aviso no topo", "mensagem promocional", "frete gratis aviso", "texto do topo"]
  },
  {
    area: "Conteúdo", title: "Construtor da página inicial", route: "conteudo-loja",
    description: "Monte a página inicial da loja, agende publicações e restaure versões.",
    keywords: ["editar home", "pagina inicial", "home da loja", "agendar publicacao", "restaurar versao", "vitrine", "secoes da home"]
  },
  {
    area: "Conteúdo", title: "Banners", route: "banners", permission: "banners.update",
    description: "Consulte os banners da loja, destinos, agenda e estado de publicação.",
    keywords: ["trocar banner", "carrossel", "hero", "agendar banner", "publicar banner", "destaque da home"]
  },
  // Governança
  {
    area: "Governança", title: "Aprovações", route: "aprovacoes",
    description: "Escolha a fila para decidir; cada aprovação acontece no fluxo de origem.",
    keywords: ["aprovar", "aprovacao", "pendente de aprovacao", "ajuste de estoque", "solicitacoes", "fila de aprovacao", "autorizar", "liberar", "decidir", "o que preciso aprovar"]
  },
  {
    area: "Governança", title: "Relatórios e exportações", route: "relatorios",
    description: "Consulte o histórico de exportações solicitadas e o estado de cada uma.",
    keywords: ["exportar", "exportacao", "baixar relatorio", "csv", "planilha", "excel", "relatorio de vendas", "gerar relatorio", "download"]
  },
  {
    area: "Governança", title: "Logs de atividades (auditoria)", route: "auditoria", permission: "audit.read",
    description: "Consulte quem fez o quê, em qual área e quando, com os detalhes de cada registro.",
    keywords: ["auditoria", "historico de alteracoes", "quem alterou", "quem fez", "registro de atividades", "rastro", "log", "trilha de auditoria", "exportar logs"]
  },
  {
    area: "Governança", title: "Usuários e acessos", route: "usuarios", permission: "users.read",
    description: "Consulte as pessoas com acesso ao painel e seus papéis.",
    keywords: ["criar usuario", "novo usuario", "convidar usuario", "funcionario", "permissao", "dar acesso", "remover acesso", "bloquear usuario", "cargo", "papel"]
  },
  {
    area: "Governança", title: "Privacidade e LGPD: solicitações de titulares", route: "politicas", permission: "privacy.requests.manage",
    description: "Na Central de conformidade, atenda pedidos de titulares: acesso, correção, exclusão e portabilidade.",
    keywords: ["lgpd", "privacidade", "dados pessoais", "excluir meus dados", "exportar dados", "apagar dados", "titular", "direito do titular", "consentimento", "dpo", "canal de privacidade", "pedido de exclusao"]
  },
  {
    area: "Governança", title: "Políticas e conformidade", route: "politicas",
    description: "Consulte as políticas e os textos de conformidade da loja.",
    keywords: ["termos de uso", "politica de privacidade", "politica de troca", "documentos legais", "juridico", "conformidade", "compliance", "regulamento"]
  },
  {
    area: "Governança", title: "Alertas", route: "alertas",
    description: "Veja as ocorrências que pedem acompanhamento e abra a área responsável.",
    keywords: ["o que esta errado", "problemas", "avisos", "atrasos", "notificacoes", "urgente", "pendencias gerais"]
  },
  {
    area: "Governança", title: "Configurações estratégicas", route: "configuracoes-estrategicas",
    description: "Consulte as políticas comerciais versionadas em vigor.",
    keywords: ["configuracoes", "ajustes", "parametros", "politica comercial", "regras do negocio", "versoes de regra", "configurar"]
  },
  {
    area: "Atendimento", title: "Atendimentos", route: "atendimentos", permission: "support.conversations.read",
    description: "Acompanhe as conversas de atendimento com clientes.",
    keywords: ["suporte", "chat", "reclamacao", "ticket", "responder cliente", "sac", "mensagens"]
  },
  {
    area: "Atendimento", title: "Central de Ajuda", route: "central-ajuda",
    description: "Consulte os artigos da Central de Ajuda.",
    keywords: ["faq", "perguntas frequentes", "tutorial", "duvidas"]
  }
]);

const tecnico = build("tecnico", [
  {
    area: "Monitoramento", title: "Visão geral técnica", route: "",
    description: "Resumo do estado da plataforma, integrações e filas.",
    keywords: ["status geral", "saude do sistema", "resumo tecnico", "painel tecnico", "inicio"]
  },
  {
    area: "Monitoramento", title: "Saúde dos serviços", route: "saude-servicos",
    description: "Estado atual dos serviços e integrações usados pela loja.",
    keywords: ["status", "servico fora do ar", "uptime", "healthcheck", "disponibilidade", "lentidao", "esta funcionando", "e-mail", "frete", "pagamento fora"]
  },
  {
    area: "Diagnóstico", title: "Logs técnicos", route: "logs",
    description: "Consulte os registros técnicos, com filtro por texto.",
    keywords: ["log", "registros", "historico tecnico", "mensagens do sistema", "debug", "auditoria de sistema", "investigar"]
  },
  {
    area: "Diagnóstico", title: "Erros", route: "erros",
    description: "Erros registrados pela plataforma e seu estado.",
    keywords: ["erro", "bug", "falha do sistema", "excecao", "500", "problema tecnico", "stack", "sentry", "revisar erros"]
  },
  {
    area: "Segurança", title: "Segurança", route: "seguranca",
    description: "Eventos de segurança, tentativas de acesso e alertas.",
    keywords: ["seguranca", "ataque", "login suspeito", "bloqueio de ip", "senha", "mfa", "2fa", "tentativas de acesso", "vulnerabilidade", "rate limit", "fraude"]
  },
  {
    area: "Segurança", title: "Acessos técnicos", route: "acessos-tecnicos",
    description: "Pessoas com acesso técnico ao sistema e seus papéis.",
    keywords: ["usuarios tecnicos", "dar acesso", "remover acesso", "permissoes", "desenvolvedor", "administrador do sistema", "criar usuario"]
  },
  {
    area: "Integrações", title: "Integrações (Bling, pagamento, frete)", route: "integracoes",
    description: "Estado e verificação das integrações externas: Bling, Mercado Pago, frete e e-mail.",
    keywords: ["bling", "erp", "mercado pago", "pagamento", "melhor envio", "conectar bling", "token do bling", "reautorizar", "sincronizar", "integracao", "api", "nota fiscal integracao", "resend", "email transacional"]
  },
  {
    area: "Integrações", title: "Webhooks", route: "webhooks",
    description: "Eventos recebidos de integrações e o resultado do processamento.",
    keywords: ["webhook", "evento recebido", "reprocessar webhook", "callback", "notificacao do mercado pago", "evento do bling", "retorno de pagamento"]
  },
  {
    area: "Processamento", title: "Filas", route: "filas",
    description: "Filas de processamento em segundo plano e itens aguardando.",
    keywords: ["fila", "queue", "mensagens na fila", "atrasado", "processamento", "pendentes de processamento", "travado"]
  },
  {
    area: "Processamento", title: "Jobs", route: "jobs",
    description: "Tarefas agendadas e o resultado das últimas execuções.",
    keywords: ["job", "cron", "tarefa agendada", "rotina", "rodar rotina", "execucao", "agendamento", "sincronizacao"]
  },
  {
    area: "Processamento", title: "Falhas de processamento", route: "falhas",
    description: "Itens que falharam e podem precisar de nova tentativa ou análise.",
    keywords: ["falha", "reprocessar", "tentar novamente", "retry", "erro de job", "dead letter", "nota nao emitida", "pedido nao processado"]
  },
  {
    area: "Dados", title: "Banco de dados", route: "banco-dados",
    description: "Estado e métricas do banco de dados.",
    keywords: ["database", "postgres", "tabelas", "consultas lentas", "conexoes", "migrations", "migracao", "schema"]
  },
  {
    area: "Dados", title: "Supabase", route: "supabase",
    description: "Estado do projeto Supabase usado pela plataforma.",
    keywords: ["supabase", "autenticacao", "projeto", "rls", "edge functions", "realtime"]
  },
  {
    area: "Dados", title: "Storage de arquivos", route: "storage",
    description: "Uso e estado do armazenamento de imagens e arquivos.",
    keywords: ["armazenamento", "imagens", "arquivos", "bucket", "espaco em disco", "uploads", "midia"]
  },
  {
    area: "Dados", title: "Backups", route: "backups",
    description: "Estado dos backups e pontos de restauração.",
    keywords: ["backup", "restaurar", "restauracao", "copia de seguranca", "recuperar dados", "snapshot"]
  },
  {
    area: "Dados", title: "Auditoria técnica", route: "auditoria-tecnica",
    description: "Registro das ações técnicas e administrativas sensíveis.",
    keywords: ["auditoria", "quem alterou", "historico de alteracoes", "trilha", "registro de acoes", "log de auditoria"]
  },
  {
    area: "Dados", title: "Integridade dos dados", route: "integridade-dados",
    description: "Verificações de consistência dos dados da plataforma.",
    keywords: ["integridade", "inconsistencia", "dados duplicados", "divergencia de dados", "conferir dados", "estoque divergente", "validacao"]
  },
  {
    area: "Plataforma", title: "Performance", route: "performance",
    description: "Métricas de desempenho da loja e do painel.",
    keywords: ["desempenho", "lentidao", "velocidade", "tempo de resposta", "core web vitals", "carregamento", "lento"]
  },
  {
    area: "Plataforma", title: "Deploys", route: "deploys",
    description: "Histórico de publicações da plataforma.",
    keywords: ["deploy", "publicacao", "versao no ar", "release", "rollback", "producao", "vercel"]
  },
  {
    area: "Plataforma", title: "Versões", route: "versoes",
    description: "Versões em execução da loja e do painel.",
    keywords: ["versao", "build", "commit", "atualizacao", "changelog", "qual versao"]
  },
  {
    area: "Plataforma", title: "Sessões", route: "sessoes",
    description: "Sessões ativas de acesso ao painel.",
    keywords: ["sessao", "sessoes ativas", "encerrar sessao", "derrubar login", "logins", "dispositivos conectados"]
  },
  {
    area: "Plataforma", title: "Feature flags", route: "feature-flags",
    description: "Recursos ligados ou desligados na plataforma.",
    keywords: ["flag", "ligar recurso", "desligar recurso", "habilitar funcao", "liberar funcionalidade", "experimento", "toggle"]
  },
  {
    area: "Plataforma", title: "Configurações técnicas", route: "configuracoes-tecnicas",
    description: "Parâmetros técnicos não secretos da plataforma.",
    keywords: ["configuracoes", "parametros", "ajustes tecnicos", "variaveis", "configurar", "settings"]
  },
  {
    area: "Atendimento", title: "Atendimentos técnicos", route: "atendimentos", permission: "support.conversations.read",
    description: "Atendimentos encaminhados ao time técnico.",
    keywords: ["suporte", "chamado", "ticket tecnico", "responder", "conversas"]
  }
]);

export const SEARCH_ACTIONS: Record<PanelRouteRole, readonly SearchAction[]> = {
  administracao,
  operacional,
  gerencia,
  tecnico
};

/** Ações do painel; esconde as que exigem uma permissão que o cliente sabe estar negada. */
export function actionsForPanel(
  panel: PanelRouteRole,
  capabilities: Readonly<Record<string, boolean>> = {}
): readonly SearchAction[] {
  return SEARCH_ACTIONS[panel].filter((action) => !action.permission || capabilities[action.permission] !== false);
}

/** Ações sugeridas quando a busca está vazia. */
const SUGGESTED_TITLES: Record<PanelRouteRole, readonly string[]> = {
  administracao: ["Cadastrar produto", "Aprovar solicitações de representantes", "Cupons de desconto", "Reembolsar pedido ou devolução", "Banners"],
  operacional: ["Pedidos pagos para separar", "Pedidos prontos para enviar", "Notas fiscais e NF-e", "Entregas de kits MG", "Estoque"],
  gerencia: ["Aprovar solicitações de representantes", "Controle financeiro", "Fechamentos de comissão", "Aprovações", "Logs de atividades (auditoria)"],
  tecnico: ["Erros", "Saúde dos serviços", "Falhas de processamento", "Integrações (Bling, pagamento, frete)", "Logs técnicos"]
};

export function suggestedActions(panel: PanelRouteRole, available: readonly SearchAction[] = SEARCH_ACTIONS[panel]) {
  return SUGGESTED_TITLES[panel].flatMap((title) => available.filter((action) => action.title === title).slice(0, 1));
}

export function searchActions(query: string, panel: PanelRouteRole, capabilities?: Readonly<Record<string, boolean>>, limit = 6) {
  return rankSearch(query, actionsForPanel(panel, capabilities), limit);
}
