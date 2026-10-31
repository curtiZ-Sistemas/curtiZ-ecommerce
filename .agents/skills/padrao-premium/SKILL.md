---
name: padrao-premium
description: Checklist de acabamento para sites e sistemas com cara de produto premium - tipografia, espaçamento, cor, estados, movimento, imagens e microtextos. Use ao construir ou revisar qualquer interface da curti Z.
---
# Padrão premium (acabamento)

Na curti Z, a paleta, a direção visual e as larguras de validação do `AGENTS.md` prevalecem sobre este checklist.

Premium não é enfeite: é consistência e cuidado em cada detalhe. Use como checklist ao construir e ao revisar.

## Tipografia
- Escala com proporção fixa (ex.: 1,25) e tamanhos fluidos (`clamp`). No máximo 2 famílias; pesos com propósito (400 texto, 600–800 títulos).
- Corpo 16–18 px, linhas de 45–75 caracteres, `line-height` 1,5–1,7 (serifadas um pouco mais). Títulos com `text-wrap: balance`, sem palavras sozinhas na última linha.
- Números em tabelas/preços com `font-variant-numeric: tabular-nums`.

## Espaço e grade
- Espaçamentos múltiplos de 8 px (4 px para ajustes finos). Respiro entre seções maior que dentro delas.
- Uma grade por página; bordas alinhadas na mesma linha vertical. Larguras máximas: texto 68ch, conteúdo ~72rem.

## Cor e profundidade
- Cores só dos tokens. Destaque usado com parcimônia (ações e o elemento memorável).
- Sombras raras e com a cor do fundo (nunca a mesma sombra cinza em tudo). Raio com hierarquia (botão ≠ cartão ≠ imagem).
- Contraste AA no mínimo; texto sobre foto só com camada de cor que garanta leitura.

## Estados e interação
- Todo elemento clicável tem: normal, passar o mouse, foco visível, pressionado, desativado. Sistemas: carregando, vazio, erro, sucesso.
- Alvos de toque ≥ 44 px. Movimento curto (150–250 ms), com propósito, e respeitando "reduzir movimento".

## Imagens e ícones
- Fotos reais dos produtos, mesmo tratamento (cor e corte). `width/height` definidos, formatos modernos, `loading="lazy"` abaixo da dobra.
- Ícones de uma só família e espessura; SVG inline com `aria-hidden` quando decorativos.

## Microtextos
- Botões dizem a ação ("Agendar horário"). Erros dizem o que aconteceu e como resolver. Sem "Clique aqui", sem "Saiba mais" solto.
- Português correto, mesmo termo para a mesma coisa em todo o site.

## Últimos 5 minutos
Olhe a página em 375 e 1440 px e **tire um enfeite** (conselho de Chanel). Conferiu tudo? Então está pronto.
