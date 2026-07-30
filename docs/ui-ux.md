# UI/UX da loja

## Direção visual

A loja usa uma linguagem editorial sóbria, com superfícies claras, vermelho Curtiz e cantos
discretos. Os raios variam de 3 a 12 px; sombras são reservadas para hierarquia, menus e
feedbacks flutuantes. Grid, campos, botões e estados interativos compartilham os mesmos tokens em
`apps/store/src/app/globals.css`.

## Responsividade

Os componentes possuem comportamento próprio para desktop, tablet e celular. As larguras mínimas
validadas são 320, 375, 390 e 430 px, além de 768 e 1440 px. O cabeçalho mobile substitui a busca
e a navegação desktop por controles dedicados, o catálogo usa filtros recolhíveis e carrinho e
checkout passam para uma coluna.

O teste `tests/e2e/responsive.spec.ts` verifica ausência de rolagem horizontal nas rotas
principais e mantém marca, menu e carrinho acessíveis nas quatro larguras de celular.

## Feedback e carregamento

- `RouteFeedback` apresenta uma barra imediata durante navegações internas.
- `app/loading.tsx` fornece skeletons para transições de rota.
- Formulários assíncronos desabilitam reenvio e mostram spinner.
- Carrinho anuncia alterações por região `aria-live` e bloqueia cliques repetidos durante a
  atualização local.
- Links Next.js mantêm o prefetch padrão para rotas elegíveis.

## Desempenho visual

O hero usa `hero-curtiz.webp` (aproximadamente 83 KB) no lugar do PNG original de cerca de
2 MB. As imagens de produto continuam em arquivos-fonte com transparência, mas são entregues pelo
`next/image` com `sizes` responsivos e negociação automática do formato adequado.

## Carrinho

O carrinho só persiste dados depois de concluir a hidratação do `localStorage`. Isso impede que um
estado vazio inicial apague itens salvos. Desktop usa lista e resumo em duas colunas; mobile usa
cards compactos em uma coluna. Quantidade, variação, preço unitário, subtotal e remoção possuem
hierarquia e rótulos próprios.

## Ajuda

O assistente flutuante é não modal no desktop e limitado ao viewport no celular. Ele pode ser
minimizado ou fechado, funciona por teclado e identifica explicitamente respostas simuladas
enquanto o provedor estiver em modo mock.

O atendimento humano continua separado: é criado pela API de suporte e sempre entra inicialmente
na fila do Administrador. O chatbot nunca transfere automaticamente um chamado ao Operacional.
