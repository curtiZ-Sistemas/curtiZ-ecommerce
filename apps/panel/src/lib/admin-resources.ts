export type AdminFieldType =
  | "text"
  | "textarea"
  | "json"
  | "number"
  | "money"
  | "percentage"
  | "boolean"
  | "datetime"
  | "select";

export type AdminResourceField = {
  key: string;
  label: string;
  type: AdminFieldType;
  required?: boolean;
  options?: readonly string[];
  readOnly?: boolean;
};

export type AdminResourceDefinition = {
  label: string;
  singular: string;
  description: string;
  table: string;
  readPermission: string;
  writePermission?: string;
  select: string;
  searchColumns: readonly string[];
  fields: readonly AdminResourceField[];
  allowCreate: boolean;
  allowArchive: boolean;
  archiveField?: string;
  archiveValue?: string | boolean;
  restoreValue?: string | boolean;
  orderColumn: string;
  createdByField?: string;
  updatedByField?: string;
};

export const adminResourceKeys = [
  "categorias",
  "modelos",
  "colecoes",
  "variacoes",
  "midias",
  "pedidos",
  "clientes",
  "banners",
  "pagina-inicial",
  "conteudo",
  "marketing",
  "cupons",
  "kits",
  "niveis",
  "metas",
  "comissoes",
  "campanhas",
  "avaliacoes",
  "treinamentos",
  "contratos",
  "configuracoes"
] as const;

export type AdminResourceKey = (typeof adminResourceKeys)[number];

export const adminResources: Record<AdminResourceKey, AdminResourceDefinition> = {
  categorias: {
    label: "Categorias",
    singular: "categoria",
    description: "Organize a navegação, hierarquia e SEO do catálogo.",
    table: "categories",
    readPermission: "catalog.taxonomy.manage",
    writePermission: "catalog.taxonomy.manage",
    select: "id,name,slug,description,active,sort_order,seo_title,seo_description,updated_at",
    searchColumns: ["name", "slug"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "sort_order", label: "Ordem", type: "number" },
      { key: "seo_title", label: "Título SEO", type: "text" },
      { key: "seo_description", label: "Descrição SEO", type: "textarea" },
      { key: "active", label: "Ativa", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "sort_order"
  },
  modelos: {
    label: "Modelos",
    singular: "modelo",
    description: "Agrupe produtos que compartilham construção e identidade comercial.",
    table: "product_models",
    readPermission: "catalog.taxonomy.manage",
    writePermission: "catalog.taxonomy.manage",
    select: "id,name,slug,description,active,sort_order,updated_at",
    searchColumns: ["name", "slug"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "sort_order", label: "Ordem", type: "number" },
      { key: "active", label: "Ativo", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "sort_order"
  },
  colecoes: {
    label: "Coleções",
    singular: "coleção",
    description: "Defina agrupamentos editoriais e períodos de publicação.",
    table: "collections",
    readPermission: "catalog.taxonomy.manage",
    writePermission: "catalog.taxonomy.manage",
    select: "id,name,slug,description,starts_at,ends_at,active,created_at",
    searchColumns: ["name", "slug"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "starts_at", label: "Início", type: "datetime" },
      { key: "ends_at", label: "Término", type: "datetime" },
      { key: "active", label: "Ativa", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "created_at"
  },
  variacoes: {
    label: "Variações",
    singular: "variação",
    description: "Gerencie SKUs, cores, tamanhos e códigos de barras.",
    table: "product_variants",
    readPermission: "products.read",
    writePermission: "products.update",
    select: "id,product_id,sku,color_name,color_hex,size,barcode,price_override,active,updated_at",
    searchColumns: ["sku", "color_name", "size", "barcode"],
    fields: [
      { key: "product_id", label: "ID do produto", type: "text", required: true },
      { key: "sku", label: "SKU", type: "text", required: true },
      { key: "color_name", label: "Cor", type: "text", required: true },
      { key: "color_hex", label: "Código da cor", type: "text" },
      { key: "size", label: "Tamanho", type: "text", required: true },
      { key: "barcode", label: "Código de barras", type: "text" },
      { key: "price_override", label: "Preço específico", type: "number" },
      { key: "active", label: "Ativa", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "updated_at"
  },
  midias: {
    label: "Mídias",
    singular: "mídia",
    description: "Associe imagens otimizadas a produtos e variações.",
    table: "product_images",
    readPermission: "products.read",
    writePermission: "products.update",
    select:
      "id,product_id,variant_id,storage_path,alt_text,sort_order,is_primary,width,height,created_at",
    searchColumns: ["storage_path", "alt_text"],
    fields: [
      { key: "product_id", label: "ID do produto", type: "text", required: true },
      { key: "variant_id", label: "ID da variação", type: "text" },
      { key: "storage_path", label: "Caminho no Storage", type: "text", required: true },
      { key: "alt_text", label: "Texto alternativo", type: "text", required: true },
      { key: "sort_order", label: "Ordem", type: "number" },
      { key: "is_primary", label: "Principal", type: "boolean" },
      { key: "width", label: "Largura", type: "number", required: true },
      { key: "height", label: "Altura", type: "number", required: true }
    ],
    allowCreate: true,
    allowArchive: false,
    orderColumn: "sort_order"
  },
  pedidos: {
    label: "Pedidos",
    singular: "pedido",
    description: "Consulte pedidos sem contornar o fluxo transacional de status.",
    table: "orders",
    readPermission: "orders.read_all",
    select: "id,public_code,customer_email_snapshot,status,payment_status,grand_total,created_at",
    searchColumns: ["public_code", "customer_email_snapshot"],
    fields: [],
    allowCreate: false,
    allowArchive: false,
    orderColumn: "created_at"
  },
  clientes: {
    label: "Clientes",
    singular: "cliente",
    description: "Consulte cadastros com dados limitados ao necessário.",
    table: "profiles",
    readPermission: "users.read",
    select: "id,full_name,email_snapshot,status,created_at,updated_at",
    searchColumns: ["full_name", "email_snapshot"],
    fields: [],
    allowCreate: false,
    allowArchive: false,
    orderColumn: "created_at"
  },
  banners: {
    label: "Banners",
    singular: "banner",
    description: "Publique imagens desktop e mobile com destino e agendamento.",
    table: "banners",
    readPermission: "banners.update",
    writePermission: "banners.update",
    select:
      "id,internal_title,title,subtitle,description,image_path_desktop,image_path_mobile,alt_text,button_text,destination_type,destination_id,destination_url,open_new_tab,position,status,starts_at,ends_at,sort_order,priority,overlay_color,content_alignment,created_by,updated_by,updated_at",
    searchColumns: ["internal_title", "title", "position", "destination_url"],
    fields: [
      { key: "internal_title", label: "Título interno", type: "text", required: true },
      { key: "title", label: "Título visível", type: "text", required: true },
      { key: "subtitle", label: "Subtítulo", type: "textarea" },
      { key: "description", label: "Descrição", type: "textarea" },
      { key: "image_path_desktop", label: "Imagem desktop", type: "text", required: true },
      { key: "image_path_mobile", label: "Imagem mobile", type: "text", required: true },
      { key: "alt_text", label: "Texto alternativo", type: "text", required: true },
      { key: "button_text", label: "Texto do botão", type: "text" },
      {
        key: "destination_type",
        label: "Tipo de destino",
        type: "select",
        required: true,
        options: [
          "none",
          "product",
          "category",
          "collection",
          "institutional_page",
          "guide",
          "campaign",
          "internal_page",
          "predefined_search",
          "external_url"
        ]
      },
      { key: "destination_id", label: "Destino selecionado", type: "text" },
      { key: "destination_url", label: "Destino", type: "text", required: true },
      { key: "open_new_tab", label: "Abrir em nova guia", type: "boolean" },
      {
        key: "position",
        label: "Posição",
        type: "select",
        required: true,
        options: ["hero", "home", "category"]
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["draft", "scheduled", "published", "inactive", "expired", "archived"]
      },
      { key: "starts_at", label: "Início", type: "datetime" },
      { key: "ends_at", label: "Término", type: "datetime" },
      { key: "sort_order", label: "Ordem", type: "number" },
      { key: "priority", label: "Prioridade", type: "number" },
      { key: "overlay_color", label: "Cor de sobreposição", type: "text" },
      {
        key: "content_alignment",
        label: "Alinhamento",
        type: "select",
        options: ["left", "center", "right"]
      }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "status",
    archiveValue: "archived",
    restoreValue: "draft",
    orderColumn: "sort_order",
    createdByField: "created_by",
    updatedByField: "updated_by"
  },
  "pagina-inicial": {
    label: "Construtor da página inicial",
    singular: "seção",
    description: "Reordene, agende e publique as seções da página inicial.",
    table: "homepage_sections",
    readPermission: "content.manage",
    writePermission: "content.manage",
    select:
      "id,section_type,title,subtitle,settings,active,starts_at,ends_at,sort_order,updated_at",
    searchColumns: ["title", "subtitle", "section_type"],
    fields: [
      {
        key: "section_type",
        label: "Tipo",
        type: "select",
        required: true,
        options: [
          "banner_hero",
          "featured_products",
          "categories_grid",
          "banner_promo",
          "reviews_carousel",
          "brands_strip",
          "custom_banner"
        ]
      },
      { key: "title", label: "Título", type: "text" },
      { key: "subtitle", label: "Subtítulo", type: "textarea" },
      { key: "settings", label: "Configuração (JSON)", type: "json", required: true },
      { key: "active", label: "Ativa", type: "boolean" },
      { key: "starts_at", label: "Início", type: "datetime" },
      { key: "ends_at", label: "Término", type: "datetime" },
      { key: "sort_order", label: "Ordem", type: "number" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "sort_order",
    createdByField: "created_by",
    updatedByField: "updated_by"
  },
  conteudo: {
    label: "Conteúdo",
    singular: "página",
    description: "Mantenha páginas institucionais e metadados de busca.",
    table: "cms_pages",
    readPermission: "content.manage",
    writePermission: "content.manage",
    select: "id,title,slug,summary,status,seo_title,seo_description,revision,updated_at",
    searchColumns: ["title", "slug", "summary"],
    fields: [
      { key: "title", label: "Título", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "summary", label: "Resumo", type: "textarea" },
      { key: "seo_title", label: "Título SEO", type: "text" },
      { key: "seo_description", label: "Descrição SEO", type: "textarea" },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["draft", "published", "archived"]
      }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "status",
    archiveValue: "archived",
    restoreValue: "draft",
    orderColumn: "updated_at",
    createdByField: "author_id"
  },
  marketing: {
    label: "Marketing",
    singular: "segmento",
    description: "Organize públicos e critérios de comunicação.",
    table: "marketing_segments",
    readPermission: "content.manage",
    writePermission: "content.manage",
    select: "id,name,definition,active,created_at",
    searchColumns: ["name"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "definition", label: "Critérios (JSON)", type: "json", required: true },
      { key: "active", label: "Ativo", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "created_at",
    createdByField: "created_by"
  },
  cupons: {
    label: "Cupons",
    singular: "cupom",
    description: "Configure regras comerciais calculadas no servidor.",
    table: "coupons",
    readPermission: "promotions.advanced_manage",
    writePermission: "promotions.advanced_manage",
    select:
      "id,code,name,discount_type,discount_value,minimum_order_value,usage_limit,combinable,starts_at,ends_at,active,created_at",
    searchColumns: ["code", "name"],
    fields: [
      { key: "code", label: "Código", type: "text", required: true },
      { key: "name", label: "Nome", type: "text", required: true },
      {
        key: "discount_type",
        label: "Tipo",
        type: "select",
        required: true,
        options: ["percentage", "fixed"]
      },
      { key: "discount_value", label: "Valor", type: "number", required: true },
      { key: "minimum_order_value", label: "Pedido mínimo", type: "number" },
      { key: "usage_limit", label: "Limite de usos", type: "number" },
      { key: "combinable", label: "Combinável", type: "boolean" },
      { key: "starts_at", label: "Início", type: "datetime", required: true },
      { key: "ends_at", label: "Término", type: "datetime", required: true },
      { key: "active", label: "Ativo", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "created_at",
    createdByField: "created_by"
  },
  kits: {
    label: "Kits",
    singular: "kit",
    description: "Gerencie kits comerciais e regras de ativação.",
    table: "kits",
    readPermission: "representatives.read_all",
    writePermission: "representatives.rules.manage",
    select:
      "id,name,slug,description,price_in_cents,active,required_for_activation,version,updated_at",
    searchColumns: ["name", "slug"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea", required: true },
      { key: "price_in_cents", label: "Preço", type: "money", required: true },
      { key: "required_for_activation", label: "Obrigatório para ativação", type: "boolean" },
      { key: "active", label: "Ativo", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "updated_at",
    createdByField: "created_by"
  },
  niveis: {
    label: "Níveis",
    singular: "nível",
    description: "Defina a progressão dos representantes.",
    table: "representative_levels",
    readPermission: "representatives.read_all",
    writePermission: "representatives.rules.manage",
    select: "id,name,slug,rank,description,active,updated_at",
    searchColumns: ["name", "slug"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "rank", label: "Posição", type: "number", required: true },
      { key: "description", label: "Descrição", type: "textarea", required: true },
      { key: "active", label: "Ativo", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "rank"
  },
  metas: {
    label: "Metas",
    singular: "meta",
    description: "Acompanhe metas individuais ou por nível.",
    table: "representative_goals",
    readPermission: "representatives.read_all",
    writePermission: "representatives.rules.manage",
    select: "id,representative_id,level_id,title,period_start,period_end,target,active,created_at",
    searchColumns: ["title"],
    fields: [
      { key: "representative_id", label: "ID do representante", type: "text" },
      { key: "level_id", label: "ID do nível", type: "text" },
      { key: "title", label: "Título", type: "text", required: true },
      { key: "period_start", label: "Início", type: "text", required: true },
      { key: "period_end", label: "Término", type: "text", required: true },
      { key: "target", label: "Meta (JSON)", type: "json", required: true },
      { key: "active", label: "Ativa", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "created_at",
    createdByField: "created_by"
  },
  comissoes: {
    label: "Comissões autorizadas",
    singular: "regra",
    description: "Configure regras versionadas de comissão.",
    table: "commission_rules",
    readPermission: "representatives.commissions.read_all",
    writePermission: "representatives.rules.manage",
    select:
      "id,name,version,basis_points,maximum_in_cents,active,effective_from,effective_until,created_at",
    searchColumns: ["name"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "version", label: "Versão", type: "number", required: true },
      { key: "basis_points", label: "Comissão", type: "percentage", required: true },
      { key: "maximum_in_cents", label: "Teto", type: "money" },
      { key: "effective_from", label: "Vigência inicial", type: "datetime", required: true },
      { key: "effective_until", label: "Vigência final", type: "datetime" },
      { key: "active", label: "Ativa", type: "boolean" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "active",
    archiveValue: false,
    restoreValue: true,
    orderColumn: "created_at",
    createdByField: "created_by"
  },
  campanhas: {
    label: "Campanhas",
    singular: "campanha",
    description: "Planeje campanhas e seu período de veiculação.",
    table: "creative_campaigns",
    readPermission: "creatives.manage",
    writePermission: "creatives.manage",
    select: "id,name,slug,description,status,starts_at,ends_at,updated_at",
    searchColumns: ["name", "slug", "description"],
    fields: [
      { key: "name", label: "Nome", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea", required: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["draft", "pending_review", "approved", "published", "archived"]
      },
      { key: "starts_at", label: "Início", type: "datetime" },
      { key: "ends_at", label: "Término", type: "datetime" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "status",
    archiveValue: "archived",
    restoreValue: "draft",
    orderColumn: "updated_at",
    createdByField: "created_by"
  },
  avaliacoes: {
    label: "Avaliações",
    singular: "avaliação",
    description: "Modere avaliações, denúncias, mídias e respostas da curti Z.",
    table: "reviews",
    readPermission: "reviews.manage",
    writePermission: "reviews.manage",
    select:
      "id,customer_id,product_id,order_item_id,variant_id,rating,title,content,status,verified_purchase,moderation_reason,brand_response,moderated_by,created_at,edited_at,responded_at",
    searchColumns: ["title", "content"],
    fields: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["pending", "approved", "rejected", "hidden", "reported", "archived"]
      },
      { key: "moderation_reason", label: "Justificativa da moderação", type: "textarea" },
      { key: "brand_response", label: "Resposta da curti Z", type: "textarea" }
    ],
    allowCreate: false,
    allowArchive: true,
    archiveField: "status",
    archiveValue: "archived",
    restoreValue: "pending",
    orderColumn: "created_at",
    updatedByField: "moderated_by"
  },
  treinamentos: {
    label: "Treinamentos",
    singular: "treinamento",
    description: "Publique materiais de capacitação para a rede.",
    table: "training_contents",
    readPermission: "training.manage",
    writePermission: "training.manage",
    select: "id,title,description,content_type,storage_path,status,sort_order,updated_at",
    searchColumns: ["title", "description"],
    fields: [
      { key: "title", label: "Título", type: "text", required: true },
      { key: "description", label: "Descrição", type: "textarea", required: true },
      {
        key: "content_type",
        label: "Tipo",
        type: "select",
        required: true,
        options: ["video", "document", "link"]
      },
      { key: "storage_path", label: "Arquivo ou destino", type: "text", required: true },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["draft", "published", "archived"]
      },
      { key: "sort_order", label: "Ordem", type: "number" }
    ],
    allowCreate: true,
    allowArchive: true,
    archiveField: "status",
    archiveValue: "archived",
    restoreValue: "draft",
    orderColumn: "sort_order",
    createdByField: "created_by",
    updatedByField: "updated_by"
  },
  contratos: {
    label: "Contratos",
    singular: "contrato",
    description: "Acompanhe contratos da rede e seus estados.",
    table: "representative_contracts",
    readPermission: "representatives.read_all",
    select: "id,representative_id,version,storage_path,accepted_at",
    searchColumns: ["version"],
    fields: [],
    allowCreate: false,
    allowArchive: false,
    orderColumn: "accepted_at"
  },
  configuracoes: {
    label: "Configurações administrativas",
    singular: "configuração",
    description: "Mantenha parâmetros não secretos da operação.",
    table: "system_settings",
    readPermission: "content.manage",
    select: "key,value,is_public,version,updated_at",
    searchColumns: ["key"],
    fields: [],
    allowCreate: false,
    allowArchive: false,
    orderColumn: "updated_at"
  }
};

export function isAdminResource(value: string): value is AdminResourceKey {
  return adminResourceKeys.includes(value as AdminResourceKey);
}
