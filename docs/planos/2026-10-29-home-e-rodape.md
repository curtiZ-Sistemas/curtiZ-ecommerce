# Plano — design da página inicial e rodapé com identificação legal

Status: **executado em 2026-10-29 de forma conservadora** (só correções e melhorias, sem redesenho). Pendente: preencher os dados da empresa no painel, aplicar a migration e conferir o visual no navegador.
Execução recomendada: skill [equipe-leve-temporaria](../../.agents/skills/equipe-leve-temporaria/SKILL.md). Qualquer modelo pode executar uma tarefa por vez, na ordem da tabela de progresso.

## Regras para quem executar

- Siga o [AGENTS.md](../../AGENTS.md), a `lean-codex` e a `usar-graphify` (consulte o mapa antes de abrir arquivos).
- A direção oficial é [docs/design-direction.md](../design-direction.md) (varejo orientado à conversão, vermelho da marca concentrado em CTA, foco e navegação ativa, Manrope, Lucide, sem glassmorphism, gradientes decorativos, cards para tudo ou animações longas). Ela prevalece sobre qualquer skill.
- Preserve a paleta (`--brand-*`, `--neutral-*`, `--ink` em `apps/store/src/app/globals.css`), as funcionalidades e os dados.
- Uma tarefa por vez, com o critério de pronto cumprido e registrado na tabela de progresso antes da próxima.
- Não invente CNPJ, razão social, endereço, selos, avaliações ou números. Dado ausente é pendência, não texto inventado.
- Não faça commit, push, migration em produção ou deploy sem pedido explícito do usuário.

## Objetivo

1. A home deve parecer uma loja de produto com ritmo e hierarquia claros, com um elemento memorável e o resto disciplinado (skill `frontend-design`), sem perder densidade nem conversão.
2. O rodapé deve ficar organizado, legível no celular e cumprir a lei. O art. 2º, I e II, do Decreto 7.962/2013 (vigente, conferido em 2026-10-29 em planalto.gov.br) obriga a mostrar, em local de destaque e de fácil visualização: nome empresarial, CNPJ, endereço físico e eletrônico e demais informações de contato.

## O que já existe (não refazer)

| Item | Onde |
|---|---|
| Home montada por seções publicadas no painel | `apps/store/src/app/page.tsx` → `HomepageSectionRenderer` (`apps/store/src/components/homepage-section-renderer.tsx`) |
| Banner (altura mobile já ajustada, sem corte) | `homepage-hero.tsx` + `.hero-picture` no `globals.css` |
| Categorias em círculos com loop e avanço de 3 s | `category-carousel.tsx` (não alterar o comportamento) |
| Cartão de produto | `apps/store/src/components/product-card.tsx` |
| Rodapé | `apps/store/src/components/site-footer.tsx` (+ `site-footer.test.tsx`) |
| Dados legais da empresa | Tabela `public.company_legal_information` (razão social `legal_name`, nome fantasia `trade_name`, CNPJ `tax_id`, `address`, `email`, `phone`, `support_channel`, `completeness_status`). Hoje, só usuários internos com permissão leem (RLS); a loja pública **não** acessa |

## Pendência do usuário (bloqueia a tarefa T7 em produção)

Preencher no painel (Centro jurídico) a razão social, o CNPJ, o endereço físico (sede, mesmo sendo loja só online), o e-mail e o telefone, e marcar como `complete`. Sem isso, o rodapé não mostra a identificação e o site continua fora do art. 2º.

## Tarefas

Modelo: **forte** = raciocínio e gosto; **padrão** = implementação; **leve** = verificação mecânica. A skill de equipe define qual modelo usar em cada ferramenta.

### Fase 0 — Diagnóstico (só leitura)

**T0. Auditoria da home e do rodapé** — modelo leve.
- Suba um servidor local da loja (um só) e capture `/` em 360, 390, 768, 1024 e 1440 px (topo e página inteira). Encerre o servidor ao terminar.
- Rode a `web-design-guidelines` em `homepage-section-renderer.tsx`, `product-card.tsx` e `site-footer.tsx`, a `accessibility` (foco, contraste, alvos de 44 px, headings) e a `break-ui` mentalmente no cartão de produto e no rodapé (nome longo, preço alto, categoria sem imagem).
- Pronto quando: o relatório, de até 40 linhas, lista os achados como `arquivo:linha — problema`, separados em confirmado e hipótese, e cita as capturas (fora do repositório).

### Fase 1 — Direção (sem código)

**T1. Especificação visual curta** — modelo forte.
- Com a `frontend-design` (dois passes: plano e revisão contra o brief), a `padrao-premium` e o relatório do T0, escreva no fim deste arquivo, em "Especificação aprovada", até 30 linhas:
  - escala tipográfica com Manrope (corpo 16 px, títulos de seção em `clamp`, `text-wrap: balance`, preços em `tabular-nums`);
  - ritmo vertical entre seções (múltiplos de 8 px, respiro entre seções maior que dentro delas, igual em todas);
  - o **único** elemento memorável da home e o que fica quieto;
  - os padrões a evitar, cruzando a lista da `frontend-design` (rótulo em caixa-alta sobre cada título, kit de cards iguais, sombra cinza em tudo) com o `design-direction.md`;
  - a estrutura do rodapé em ASCII, para mobile e desktop.
- Pronto quando: a especificação foi aprovada pelo usuário. **Parar e pedir aprovação.**

### Fase 2 — Implementação (cada tarefa com poucos arquivos)

**T2. Ritmo e títulos das seções da home** — modelo padrão.
- Unifique o espaçamento vertical e a hierarquia de títulos (`h2` por seção, alinhamento à esquerda, sem rótulos decorativos) nas seções renderizadas por `homepage-section-renderer.tsx`, apenas via CSS e classes existentes. Remova as regras duplicadas que se sobrescrevem no `globals.css` dessas seções; não acrescente camadas novas por cima.
- Pronto quando: os testes `homepage-*.test.tsx` passam e as capturas em 390 e 1440 px mostram o mesmo espaçamento entre todas as seções.

**T3. Cartão de produto e vitrines** — modelo padrão.
- Proporção de imagem única, nome com até 2 linhas, preço com `tabular-nums`, alvo de toque ≥ 44 px, hover discreto de 150 a 200 ms e foco visível. Use a `break-ui`: nome longo, sem desconto e com desconto.
- Não mude preço, estoque nem regras; é só apresentação.
- Pronto quando: os testes do `product-card` e da vitrine passam, sem overflow horizontal em 320 px.

**T4. Faixa de benefícios e chamadas** — modelo padrão.
- Benefícios em linha, com ícone Lucide e texto curto, sem cartões nem caixas. Textos dizem o que é real, sem prometer o que a loja não oferece (confira em `help-content.ts` e nas políticas publicadas).
- Pronto quando: os testes da seção `benefits` passam e os textos foram conferidos com as fontes.

**T5. Movimento** — modelo padrão.
- Aplique o "Animation Decision Framework" da `emil-design-eng`: só anima o que tem propósito, de 150 a 250 ms, `ease-out` na entrada, nunca `scale(0)`, `prefers-reduced-motion` respeitado. O loop das categorias continua como está.
- Pronto quando: há uma lista curta do que foi removido ou ajustado, sem animação nova em seção que não precisa.

**T6. Leitura pública da identificação legal** — modelo padrão (com revisão de segurança pelo modelo forte).
- Nova migration incremental com a função `public.public_company_identification()`: `security definer`, `search_path = ''` e retorno **só** de `legal_name`, `trade_name`, `tax_id`, `address`, `email`, `phone` e `support_channel` quando `completeness_status = 'complete'` (senão, nada). `revoke` de `public`; `grant execute` para `anon` e `authenticated`. Não exponha `privacy_channel`, `data_protection_contact` nem colunas internas.
- Teste em `tests/db-static` no padrão dos existentes.
- Na loja: `apps/store/src/lib/company-identification-data.ts`, no padrão de `devtools-block-data.ts` (`unstable_cache` de 300 s, validação com zod e falha registrada que retorna `null`).
- Pronto quando: os testes db-static passam e o modelo forte revisou o diff com a `sharp-edges` (security definer) e a `supabase-postgres-best-practices` (RLS e grants).

**T7. Novo rodapé** — modelo padrão.
- Siga a estrutura aprovada no T1. O conteúdo mínimo é:
  - marca e frase curta (sem "loja oficial… experiência clara e organizada", que é genérica);
  - os grupos atuais de links (Comprar, Institucional, Políticas, Representantes) com acordeão no celular, já existente;
  - o bloco **Atendimento**, com e-mail, telefone e canal de suporte vindos do T6;
  - a **linha de identificação legal**, visível sem abrir acordeão: `Razão social · CNPJ 00.000.000/0000-00 · Endereço · e-mail`. Formate o CNPJ na exibição; não o guarde formatado;
  - a barra final com copyright e "Preferências de cookies", já existente.
- Sem dado `complete`: não mostre a linha legal e não quebre o layout.
- Pronto quando: `site-footer.test.tsx` cobre os cenários com e sem dados e não há overflow em 320 px (CNPJ e endereço longos quebram linha).

### Fase 3 — Verificação

**T8. Verificação final** — modelo leve.
- Rode, com 1 worker, o vitest dos testes alterados, o `tsc --noEmit` do apps/store (ignore `.next/types`), o eslint dos arquivos alterados e os testes db-static do T6.
- Capture `/` de novo em 360, 390, 768, 1024 e 1440 px e compare com o T0. Verifique o CLS: nada pula ao carregar fontes e imagens (`core-web-vitals`, seção CLS).
- Pronto quando: o relatório traz os comandos e as saídas resumidas, um antes e depois em até 10 linhas e as pendências reais.

**T9. Revisão do diff** — modelo forte.
- Revise o diff inteiro com a `differential-review` (no modo leve: só os arquivos do diff) e a `verification-before-completion`. Confira com o `design-direction.md`.
- Pronto quando: os achados foram corrigidos ou registrados, e o resumo final para o usuário está pronto (alterações, validações, pendências). Commit, push e deploy só com pedido do usuário.

## Progresso

| Tarefa | Modelo | Status | Evidência (1 linha) |
|---|---|---|---|
| T0 | leve | feita (por código, sem capturas) | Achados: textos de 10 a 12 px no rodapé e nos cartões; alvos de toque de 38 px; preço sem tabular-nums; hover sem movimento reduzido. |
| T1 | forte | dispensada | Usuário pediu só correções e melhorias, sem mudança grande de visual. |
| T2 | padrão | dispensada | Sem defeito de ritmo confirmado; sem capturas para justificar mudança. |
| T3 | padrão | feita | globals.css: tabular-nums, fonte de 12 px, alvo de 44 px em toque, hover sem movimento reduzido. |
| T4 | padrão | dispensada | Sem defeito confirmado. |
| T5 | padrão | dispensada | Sem animação nova; só movimento reduzido no hover do cartão (T3). |
| T6 | padrão + revisão forte | feita | Migration 20261029120000, loader, parser e testes db-static (149 arquivos passam). |
| T7 | padrão | feita | Rodapé com bloco de identificação, textos maiores e testes com e sem dados. |
| T8 | leve | parcial | vitest components 88/88, db-static 509/509, tsc e eslint limpos; sem capturas em navegador. |
| T9 | forte | a fazer | Revisão do diff pelo usuário ou pelo Codex. |

## Especificação aprovada

(preenchida no T1, após aprovação do usuário)
