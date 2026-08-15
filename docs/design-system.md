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
