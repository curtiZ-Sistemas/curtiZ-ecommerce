# Design system — curti Z

## Tokens

Os tokens vivem em `apps/store/src/app/globals.css` e `apps/panel/src/app/globals.css`.

- Marca: escala terrosa `brand-950` a `brand-50`.
- Neutros: `ink`, `neutral-900` a `neutral-50`, `white`.
- Estados: `success`, `warning`, `danger` e `info`.
- Raios: 3, 5, 8 e 12 px na loja; o painel deve convergir para a mesma disciplina.
- Elevação: `shadow-xs`, `shadow-sm` e `shadow-md`, usados somente quando existe sobreposição.
- Container: 1280 px.
- Movimento: transições de 120–180 ms e curva compartilhada; movimento reduzido é respeitado.

## Tipografia

- Família: Manrope com fallback de sistema.
- Texto-base: 15–16 px, nunca menor que 16 px em campos mobile.
- Títulos usam escala responsiva e pesos 700–800.
- Valores, totais e estados possuem hierarquia sem depender apenas de cor.

## Componentes e uso

- Botões primários: uma ação principal por contexto; incluem loading e disabled.
- Botões secundários: retorno, edição e ações não destrutivas.
- Icon buttons: área mínima de toque, nome acessível e estado pressionado quando aplicável.
- Campos: label persistente, foco no contêiner, erro/ajuda associado e nenhuma borda duplicada.
- Cards de produto: imagem uniforme, nome, avaliação, preço e favorito; sem excesso de badges.
- Skeletons: preservam a geometria da tela e não são combinados com bloqueio integral.
- Estados vazios/erro: mensagem curta, motivo e próxima ação.
- Drawers/dialogs: Escape, fechamento explícito, rolagem interna e retorno de foco.
- Tabelas: desktop tabular; mobile em lista ou cards sem rolagem horizontal extensa.

## Responsividade

- 320–430 px: margens compactas, alvo de toque confortável e ausência de conteúdo lateral.
- 768–1024 px: grid intermediário e painéis reorganizados.
- 1280 px ou mais: uso integral do container sem esticar linhas de leitura.

## Acessibilidade

- HTML semântico, skip link, labels e foco visível.
- Overlays anunciam estado e controlam foco.
- `aria-live` informa carrinho, formulário, chat e navegação.
- Nenhum status depende exclusivamente de cor.
- `prefers-reduced-motion` remove transições não essenciais.

## Elementos proibidos

- Credenciais, logs, estados técnicos e dados legais inventados na interface do cliente.
- CTA sem ação, badge falso, urgência artificial ou integração mock apresentada como real.
- Emojis como ícones, famílias de ícones misturadas e `!important` como solução padrão.

## Painéis — linguagem Etiqueta

Os quatro painéis (`apps/panel`) seguem a linguagem **Etiqueta**: a clareza de uma etiqueta de preço,
ficha de estoque e guia de envio. Estrutura precisa, tons quentes, tipografia firme e nenhum enfeite.
Não é skeuomorfismo: sem picote, código de barras decorativo, carimbo, fita ou textura.

### Onde está

- Tokens: `:root` de `apps/panel/src/app/globals.css` (mesmos nomes e valores da loja, mais estados com
  `-bg`/`-line`, `--space-*`, `--text-*`, `--font-mono`, `--duration-*` e medidas do shell).
- Primitivos CSS: `apps/panel/src/app/styles/foundation.css` (classes `ui-*` e restilização das classes
  compartilhadas legadas).
- Componentes: `apps/panel/src/components/panel-ui.tsx` e `usePanelConfirm` em `panel-prompt.tsx`.
- Estilos de cada painel: `apps/panel/src/app/styles/painel-<painel>.css`, carregados depois da fundação.
- Descrição de cada rota no cabeçalho: `apps/panel/src/components/section-copy/<papel>.ts`.

### Primitivos

| Necessidade | Componente | Classe |
| --- | --- | --- |
| Cabeçalho de página | `PageHeader` | `.ui-page-header` (o shell já usa `.page-heading`) |
| Título de seção | `SectionHeader` | `.ui-section-header`, `.dashboard-section-heading` |
| Indicadores | `KpiStrip` + `Kpi` | `.ui-kpis`, `.ui-kpi` (`data-tone` só com motivo real) |
| Status | `StatusLabel` | `.ui-label[data-tone]` ou `.status` + `green/red/orange/yellow/gray/blue/active` |
| Vazio, erro, indisponível | `StateMessage` | `.ui-state[data-kind]`, `.admin-empty-state` |
| Carregando | `LoadingBlock` | `.ui-loading`, `.ui-skeleton` |
| Busca e filtros | `Toolbar` (`sticky`) | `.ui-toolbar`, `.admin-toolbar`, `.admin-search` |
| Código, SKU, ID | `Code` | `.ui-code` |
| Números | — | `.ui-num` (algarismos tabulares); `td.ui-num` alinha à direita |
| Tabela que vira lista no celular | — | `.data-table.ui-table-stack` + `data-label` em cada `<td>` |
| Avisos | — | `.admin-feedback` + `success/error/warning/info` |
| Ações | — | `.primary-button`, `.secondary-button`, `.ghost-button`, `.danger-button`, `.icon-button` |
| Confirmação | `usePanelConfirm()` | diálogo com `tone: "danger"` para ações destrutivas |

### Regras

- Vermelho da marca só em ação principal, item ativo do menu, foco, links e prioridade crítica.
- Manrope com pesos 500/600/700 (800 só em números grandes). Corpo 14 px; nada abaixo de 12 px.
- Raios: 3 px etiquetas, 5 px botões e campos, 8 px cartões e tabelas, 12 px drawers e modais.
- Sombra só em sobreposição e em barra fixa. Cartão só para objeto independente; nunca cartão dentro de cartão.
- Status sempre com texto; cor apenas reforça.
- Estados honestos: "sem dados" é diferente de "falha"; erro oferece "Tentar novamente" sem derrubar a página.
- Movimento de 120–180 ms apenas em hover, foco e abrir/fechar; `prefers-reduced-motion` respeitado.

### Proibido nos painéis

Gradientes, glow, neon, glassmorphism, blobs, 3D, texturas, ilustrações decorativas e emojis; ícone em
quadradinho colorido em todo cartão; grade de KPIs idênticos com tendência; números ou tendências sem dado
real; eyebrow em caixa-alta acima de todo título; botão pílula; raio acima de 12 px; cartão que sobe no
hover; cores fora da paleta; modo escuro; fonte nova; ícone Sparkles para algo que não é IA.

### Propriedade durante o redesign

`globals.css`, `foundation.css`, shell, overlays e `panel-ui.tsx` pertencem ao Agente 1. Cada painel edita
apenas o próprio CSS e os próprios componentes; pedidos de mudança compartilhada vão para
`.cache/ui-paineis/pedidos-<painel>.md`.
