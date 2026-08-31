export const cookieInventoryVersion = "inventory-2";

export type CookieCategory = {
  id: string;
  label: string;
  description: string;
  required: boolean;
};

export type StorageType = "cookie" | "local_storage" | "session_storage";

export type CookieInventoryItem = {
  name_pattern: string;
  category_id: string;
  provider: string;
  purpose: string;
  duration_description: string;
  first_party: boolean;
  storage_type: StorageType;
};

export type CookieInventory = {
  categories: CookieCategory[];
  cookies: CookieInventoryItem[];
  policyVersion: string;
};

export const auditedCookieCategories: CookieCategory[] = [
  {
    id: "essential",
    label: "Essenciais",
    description: "Segurança, autenticação e recursos solicitados, como carrinho e favoritos.",
    required: true
  },
  {
    id: "preferences",
    label: "Preferências",
    description: "Memoriza escolhas de conveniência, como pesquisas recentes e indicações.",
    required: false
  },
  {
    id: "analytics",
    label: "Analytics",
    description: "Permite ao Intelligence Engine medir o uso e melhorar recomendações.",
    required: false
  }
];

export const auditedCookieInventory: CookieInventoryItem[] = [
  {
    name_pattern: "sb-*-auth-token*",
    category_id: "essential",
    provider: "Supabase Auth",
    purpose: "Mantém a sessão autenticada e renova credenciais com segurança.",
    duration_description: "Sessão ou até 12 meses quando o acesso persistente é escolhido.",
    first_party: true,
    storage_type: "cookie"
  },
  {
    name_pattern: "curtiz-auth-persistence",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Aplica a duração de sessão escolhida no login.",
    duration_description: "Sessão ou até 12 meses.",
    first_party: true,
    storage_type: "cookie"
  },
  {
    name_pattern: "curtiz-demo-session",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Mantém uma sessão autenticada no ambiente de demonstração.",
    duration_description: "Até o encerramento ou a expiração da sessão.",
    first_party: true,
    storage_type: "cookie"
  },
  {
    name_pattern: "curtiz-cookie-preferences",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Aplica no servidor as categorias autorizadas pelo visitante.",
    duration_description: "Até 12 meses ou até uma nova escolha.",
    first_party: true,
    storage_type: "cookie"
  },
  {
    name_pattern: "curtiz-cookie-consent",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Mantém no navegador a versão e as escolhas do consentimento.",
    duration_description: "Até 12 meses ou até uma nova escolha.",
    first_party: true,
    storage_type: "local_storage"
  },
  {
    name_pattern: "curtiz-cart* / curtiz-session-cart*",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Preserva os itens e a seleção do carrinho solicitados pelo visitante.",
    duration_description: "Sessão ou armazenamento persistente, conforme a escolha de acesso.",
    first_party: true,
    storage_type: "local_storage"
  },
  {
    name_pattern: "curtiz-favorites",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Mantém a lista de favoritos criada pelo visitante.",
    duration_description: "Até a remoção dos favoritos ou limpeza do navegador.",
    first_party: true,
    storage_type: "local_storage"
  },
  {
    name_pattern: "curtiz-help-* / curtiz:representative-sidebar",
    category_id: "essential",
    provider: "curti Z",
    purpose: "Mantém temporariamente o contexto solicitado de ajuda ou do portal.",
    duration_description: "Durante a sessão atual.",
    first_party: true,
    storage_type: "session_storage"
  },
  {
    name_pattern: "curtiz-recent-searches",
    category_id: "preferences",
    provider: "curti Z",
    purpose: "Exibe novamente pesquisas recentes feitas neste navegador.",
    duration_description: "Até a remoção pelo visitante ou limpeza do navegador.",
    first_party: true,
    storage_type: "local_storage"
  },
  {
    name_pattern: "curtiz_referral",
    category_id: "preferences",
    provider: "curti Z",
    purpose: "Preserva uma indicação iniciada pelo próprio visitante.",
    duration_description: "Até 30 dias ou até a retirada do consentimento.",
    first_party: true,
    storage_type: "cookie"
  },
  {
    name_pattern: "curtiz:intelligence-session",
    category_id: "analytics",
    provider: "curti Z Intelligence Engine",
    purpose: "Agrupa eventos comportamentais consentidos sem identificar diretamente o visitante.",
    duration_description: "Durante a sessão atual.",
    first_party: true,
    storage_type: "session_storage"
  },
  {
    name_pattern: "curtiz:intelligence-recent",
    category_id: "analytics",
    provider: "curti Z Intelligence Engine",
    purpose: "Mantém produtos vistos para recomendações consentidas.",
    duration_description: "Até a retirada do consentimento ou limpeza do navegador.",
    first_party: true,
    storage_type: "local_storage"
  }
];

export function normalizeCookieCategoryId(id: string) {
  return id === "functional" ? "preferences" : id;
}

export function defaultCookieInventory(policyVersion = cookieInventoryVersion): CookieInventory {
  return {
    categories: auditedCookieCategories,
    cookies: auditedCookieInventory,
    policyVersion
  };
}
