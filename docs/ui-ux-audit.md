# Auditoria de UI/UX — Curtiz

## Escopo e estado encontrado

Auditoria realizada sobre o monorepo pnpm/Turborepo com Next.js 16, React 19, TypeScript
estrito, loja em `apps/store`, painel em `apps/panel`, domínio compartilhado e infraestrutura
Supabase versionada. O repositório possui 26 entradas de página/API e 71 arquivos-fonte entre
aplicações e pacotes.

A interface já conta com uma base visual consistente, carrinho local funcional, checkout mock
identificado, catálogo demonstrativo, quatro experiências de painel, feedback de navegação,
skeletons, chat mock e testes responsivos. Supabase continua sendo a fonte de verdade quando
configurado.

## Rotas e jornadas encontradas

- Loja: home, catálogo, categorias, busca, produto, carrinho, checkout, autenticação, ajuda,
  páginas institucionais, estados de pedido e área do cliente.
- Painel: Operacional, Administração, Gerência e Técnico, com seções por perfil.
- APIs: autenticação, checkout e suporte.
- Infraestrutura: Auth, catálogo, estoque, pedidos, pagamentos, suporte, RBAC, auditoria,
  integrações, relatórios, RLS e Edge Functions.

## Diagnóstico por prioridade

### P0 — funcional e segurança

- O login retornava 503 sem Supabase, apesar de existirem contas demo documentadas.
- O antigo `seed:demo` dependia de Supabase e não atendia máquinas sem Docker.
- O modo demo precisava de sessão assinada e restrição explícita a loopback.
- A autorização real continua dependente do Supabase/RLS; o fallback local não pode alcançar
  endereços públicos nem substituir produção.

### P1 — experiência

- Favoritos existiam apenas no estado de cada card e eram perdidos na navegação.
- O cabeçalho mobile precisava completar Escape, retorno de foco e navegação de overlay.
- A busca mobile abria rapidamente, mas ainda não apresentava sugestões locais nem histórico.
- A área da conta apresentava conteúdo estático sem refletir a sessão demo.
- Mensagens de formulário eram globais; erros críticos precisam permanecer legíveis próximos
  ao fluxo principal.

### P2 — consistência e conteúdo

- Há dados demonstrativos em componentes de painel e conta. Eles estão identificados, mas devem
  migrar para views do banco quando o Supabase gerenciado for configurado.
- Algumas ações indisponíveis são corretamente desabilitadas, porém ainda dependem de fluxos de
  backend futuros.
- A home apresenta condições comerciais vindas do briefing visual. Elas devem ser substituídas
  por configuração comercial antes de uma publicação real.
- A logo presente é provisória e deve continuar explicitamente tratada como substituível.

### P3 — performance

- O hero WebP tem aproximadamente 85 KB, mas as oito imagens-fonte de produto em PNG variam de
  1,4 a 2,1 MB. `next/image` reduz a transferência, porém os ativos de origem ainda merecem
  variantes WebP/AVIF de seed.
- A maior parte das páginas é Server Component; catálogo, carrinho, checkout e overlays usam
  JavaScript apenas onde há interação.
- Não foram encontradas dependências visuais extras necessárias para esta revisão.

## Componentes reutilizáveis

- `SiteHeader`, `SiteFooter`, `BrandLogo`, `RouteFeedback`, `HelpChat`.
- `CatalogPage`, `ProductCard`, `CartProvider`, `AddToCart`.
- `AuthForm`, `SupportCenter`.
- `PanelShell`, `RevenueChart`, `SupportConsole`.
- Domínio compartilhado para dinheiro, promoções, permissões, status e suporte.

## Riscos e regressões a evitar

- Não permitir que `DEMO_MODE` funcione fora de `localhost`, `127.0.0.1` ou `::1`.
- Não expor o segredo da sessão ou senha demo em bundles públicos.
- Não bloquear o fluxo Supabase quando as credenciais existirem.
- Não transformar estado local demonstrativo em confirmação de pagamento, estoque ou pedido.
- Não introduzir overflow horizontal nas larguras de 320 a 430 px.
- Não apagar a alteração não relacionada existente em `AGENTS.md`.

## Sequência de implementação

1. Corrigir login e sessão demo sem Docker.
2. Consolidar direção visual e design system existentes.
3. Melhorar estado autenticado, favoritos, busca e overlays mobile.
4. Revisar conta, checkout, chat e painel.
5. Executar revisão anti-IA, acessibilidade e performance.
6. Validar lint, tipos, testes, builds, console e viewports.

## Critérios de conclusão

- Login dos cinco perfis demo funciona sem 503 e sem Docker.
- Supabase permanece prioritário e produção recusa modo demo.
- Interações principais possuem loading, erro e prevenção de repetição.
- Nenhuma rota principal cria overflow nas larguras testadas.
- Foco, Escape, labels, contraste e redução de movimento são preservados.
- Lint, TypeScript, testes unitários, E2E e builds passam.
