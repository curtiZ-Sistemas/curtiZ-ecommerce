# Gerenciamento de banners — correção de 09/09/2026

## Diagnóstico

Foram confirmados dois defeitos no contrato do código anterior:

- O seletor de página interna enviava `destination_id: "produtos"` (ou `ofertas`, etc.), mas `banners.destination_id` é UUID. O PostgreSQL rejeita esse valor com `22P02`. A normalização agora salva `null` para destinos sem entidade UUID e resolve entidades no servidor.
- O formulário genérico enviava campos opcionais vazios, normalizados para `null`, como `priority`, `sort_order`, `status` e `content_alignment`. Essas colunas são `NOT NULL`: o default do banco não substitui um `null` explícito. Novos banners recebem defaults no backend; a edição não sobrescreve publicação e apresentação antigas.

O tratamento anterior descartava o erro técnico do Supabase e retornava uma mensagem genérica. Agora há mensagens de validação, permissão, limite de quatro banners e schema desatualizado. Logs registram operação, código e nome da coluna/constraint, sem imprimir o registro completo, tokens ou credenciais.

**Limite da conclusão:** não havia sessão interna/ambiente de teste Supabase confirmado. Esses defeitos foram reproduzidos nos testes de contrato/handler, mas não foi possível atribuir o incidente específico do ambiente remoto a um deles mediante seu log ou uma gravação real.

## Fluxo e arquivos

- `apps/panel/src/components/banner-manager.tsx`: formulário dedicado com imagem computador/celular, arrastar e soltar, seleção, substituição, remoção, prévia, progresso e seletor pesquisável de destinos independentes. Valida antes do upload, mantém o modal aberto na falha e reutiliza uploads na tentativa seguinte. Dialog nativo controla foco e fundo inerte.
- `apps/panel/src/components/admin-resource-manager.tsx` e `src/lib/admin-resources.ts`: encaminham banners para o editor dedicado; removem os campos antigos e o editor antigo. Listagem com miniatura, destinos, editar, excluir com confirmação e ativação. Duplicação foi retirada.
- `apps/panel/src/lib/banner-management.ts`: defaults, URLs, UUIDs, arquivos presentes no Storage e resolução de destinos no servidor.
- APIs `admin/resources/[resource]`, `admin/banner-media`, `admin/banner-targets`: persistência, exclusão, permissões, upload e pesquisa. O endpoint de mídia recusa remover arquivos em uso. Arquivos antigos substituídos/excluídos são preservados para não quebrar referências compartilhadas; uploads temporários deste editor recebem tentativa de limpeza ao fechar.
- `apps/store/src/lib/storefront-data.ts` e `src/components/homepage-hero.tsx`: imagem via `picture/source` e destino conforme o mesmo breakpoint de 700 px; fallback para banners antigos. O trabalho simultâneo de layout da loja foi preservado.
- `packages/security/package.json`: exportação específica do validador UUID existente, para reutilização no navegador sem importar módulos Node de segurança.

URLs personalizadas novas não foram adicionadas ao fluxo principal; destinos antigos são preservados e URLs externas continuam sujeitos à lista de domínios autorizados.

## Banco e Storage

**Aplicar antes de publicar o código:** `supabase/migrations/202609090001_simplify_banners.sql`.

A migration altera a tabela existente, adiciona `destination_type_mobile`, `destination_id_mobile` e `destination_url_mobile`, copia os destinos antigos, acrescenta defaults e valida ambos os destinos. Não exclui banners nem campos antigos. Mantém a leitura pública dentro da janela de publicação e exige papel admin/manager mais `banners.update` (incluindo as verificações existentes de usuário ativo/MFA) para escrita.

Bucket `catalog-public`, limite de 10 MB e formatos JPG/PNG/WebP preservados. O bucket já era público para mídias do catálogo; sua visibilidade e suas policies não foram ampliadas. A API verifica explicitamente `banners.update` para enviar/remover imagens, além da RLS existente. A migration **não foi aplicada** nesta execução.

## Validações

- 30 testes passaram: contratos/defaults/UUID, imagens ausentes, URLs perigosas, referência de destino, handler de criação, respostas 401/403 e schema desatualizado. Os testes de handler usam adaptador Supabase isolado, não banco real.
- Typecheck do painel e lint dos arquivos alterados passaram. Build Cloudflare da loja passou, incluindo TypeScript. Uma tentativa anterior encontrou erro temporário em `category-carousel.tsx`, alterado simultaneamente; o build posterior passou.
- Build Cloudflare final do painel passou e gerou `.open-next/worker.js`, incluindo a validação dos destinos antes do upload. Os builds emitiram os avisos existentes de suporte parcial a Windows e convenção middleware depreciada.
- Editor em Chrome isolado com API simulada: arrastar/selecionar imagens, destinos distintos, falha de salvamento mantendo modal, retry sem repetir uploads, edição somente mobile e exclusão. Larguras 320, 390, 600, 601, 1024 e 1280 px sem overflow do modal.
- Nesse navegador isolado, o componente público carregou imagem/destino mobile em 390/700 px e desktop em 701/1280 px. Teste reproduzível: `node tests/e2e/banner-editor.isolated.cjs` (Chrome instalado; respostas de API simuladas).
- Endpoint real de listagem sem sessão: HTTP 401.
- `supabase test db supabase/tests/banner_management_test.sql`: bloqueado por conexão local indisponível. O teste transacional pgTAP foi criado e inclui UUID/defaults, persistência e RLS, com rollback.

**Pendente:** aplicar migration em ambiente de teste e executar criação/edição/exclusão pelo fluxo autenticado, confirmar objetos reais no Storage, registros no banco e RLS com usuários distintos. As verificações simuladas não substituem esse teste completo. Nenhum deploy foi realizado.
