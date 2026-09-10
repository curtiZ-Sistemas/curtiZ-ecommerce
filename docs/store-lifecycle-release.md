# Banners, conta e carrinho — preparação para publicação

## O que mudou

- Banner com setas laterais, indicação de posição, estado automático/pausado e controle de reprodução. Navegação manual pausa a reprodução; movimento reduzido desativa avanço automático. As posições legadas `home` também entram no Hero.
- A consulta de banners aceita colunas opcionais em versões diferentes do schema e registra falhas no servidor, em vez de ocultar completamente o diagnóstico atrás do fallback. A home pública consultada durante a tarefa retornava `default-hero-banner`; confirmar os banners reais após publicar e conferir as migrations do painel.
- Header mais compacto e logo com contraste sobre o vermelho; correção da coluna de 20 px que espremia o texto de cookies no celular. Opções de consentimento preservadas.
- Exclusão da conta em duas etapas: senha verificada no servidor e confirmação assinada com validade de cinco minutos. Contas internas não podem usar esse fluxo. O carrinho é limpo, o perfil é anonimizado e desativado, e o Auth recebe exclusão lógica irreversível. Vínculos de pedidos, histórico e registros de atendimento são preservados. Falha parcial não é anunciada como sucesso e permite nova tentativa.
- Produtos arquivados/inativados ou excluídos deixam avisos independentes das linhas compráveis. Não entram no total ou na seleção de compra; continuam removíveis. O prazo de 72 horas usa a data registrada no servidor, inclusive para visitantes que retornam depois. A limpeza física dos avisos expirados ocorre na próxima sincronização, sem exigir um servidor de tarefas. Dados históricos continuam bloqueando exclusões destrutivas; Arquivar permanece disponível conforme permissão.

## Banco e segurança

Aplicar apenas depois de validar em ambiente isolado, na ordem normal das migrations:

- `202609100002_customer_account_closure.sql`
- `202609100003_cart_unavailable_products.sql`
- `202609100004_product_cart_deletion_eligibility.sql`

A limpeza de conta é exclusiva de `service_role`; o navegador nunca recebe a chave. Políticas restritivas bloqueiam acesso direto de JWTs antigos às tabelas públicas já protegidas por RLS e ao Storage após encerramento. Novas tabelas futuras também devem aplicar essa restrição. As rotas de exclusão verificam a sessão real, o papel, a senha, a origem e o limite de tentativas.

Validar `supabase/tests/customer_cart_lifecycle_test.sql` com banco migrado. O banco local não estava acessível neste ambiente, então não houve execução real desses testes, aplicação de migrations ou exclusão real de usuários/produtos.

## Desempenho

O relatório fornecido apontou quatro fotos remotas grandes, o Hero e a logo. Foram geradas cópias responsivas locais para as URLs imutáveis dessas fotos: 541.062 bytes originais contra 47.346 bytes somados nas versões de 360 px. O Hero de 430 px possui 26.980 bytes contra 79.122 do original. O navegador escolhe o tamanho conforme viewport e densidade; essas medidas não são uma nova pontuação Lighthouse.

Novos banners são reduzidos e convertidos para WebP antes do upload quando isso diminui o arquivo; a validação do upload no servidor foi preservada. As fotos atuais do relatório têm mapeamento explícito em `optimized-catalog-images.json`; novas URLs continuam funcionando com a imagem original até receberem variantes.

Para atualizar essas cópias com outro relatório Lighthouse JSON:

```sh
pnpm exec tsx scripts/optimize-pagespeed-images.ts caminho/relatorio.json
```

O script reutiliza o Sharp já instalado pelo Next e trabalha sequencialmente. Não substitui arquivos no Storage nem muda dados comerciais. Revise os novos arquivos e o manifesto antes de publicar.

Alertas de código legado do Next e do beacon externo da Cloudflare, CSS compartilhado e métricas de produção precisam de nova medição após publicação. Não foram removidos recursos compartilhados ou telemetria para forçar pontuação 100.

## Validação

- Testes de unidade/contrato de senha, token, falhas parciais, catálogo, banners, carrinho e ações administrativas.
- Testes estáticos existentes do banco.
- Chrome isolado com componentes reais e respostas de API simuladas: 320, 390, 430, 768 e 1280 px; cookies, navegação dos banners, confirmação/cancelamento de exclusão e remoção de produto indisponível. Isso não comprova persistência real, RLS ou comportamento do Worker publicado.
- Lint e TypeScript dos arquivos e workspaces envolvidos.

Referências: [relatório fornecido](https://pagespeed.web.dev/analysis/https-curtiz-com-br/girmv5ung5?form_factor=mobile), [exclusão no Auth](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) e [sessões após exclusão](https://supabase.com/docs/guides/auth/managing-user-data).

## Checkout Bricks

A CSP de `/checkout` é emitida somente pelo middleware; `next.config.ts`, `_headers` e o Worker não adicionam uma segunda CSP. Em 10/09/2026, a resposta pública tinha um único cabeçalho. O hash fixo usado para o script de DeviceProfile já não correspondia ao widget entregue pelo SDK atual. O componente agora encaminha ao Mercado Pago o nonce gerado pelo próprio middleware, opção suportada pelo SDK, e a CSP libera em `img-src` apenas os pixels antifraude observados em `https://www.mercadolibre.com` e `https://www.mercadolivre.com`.

A resposta de criação do pedido passa por validação em runtime antes da montagem do Brick: total, subtotal e frete precisam ser inteiros positivos em centavos e fechar a soma confirmada pelo servidor. Para o cenário de R$ 51,00 + R$ 16,90, somente `6790 / 100`, isto é, o número `67.9`, chega a `initialization.amount`. Valor nulo, ausente, formatado ou divergente interrompe a montagem com a mensagem de recuperação existente. A configuração de produção também valida e publica a variável pública do Mercado Pago; o Access Token continua exclusivamente no secret do Worker.
