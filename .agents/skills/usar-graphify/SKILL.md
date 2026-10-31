---
name: usar-graphify
description: Consultar o mapa do código da curti Z (Graphify, 100% local) para achar arquivos, funções e ligações sem ler o projeto inteiro, economizando tokens. Use antes de procurar ou mexer em código e ao planejar mudanças.
---
# Usar o Graphify (mapa do código)

O mapa fica em `graphify-out/` (fora do Git, gerado em cada máquina). Ele complementa a `lean-codex`: consulte o mapa primeiro, depois abra só os arquivos que ele apontar.

## Trava de segurança (obrigatória)
Antes de qualquer comando, `GRAPHIFY_BACKEND` deve valer `none`. Sem isso, o Graphify pode escolher sozinho um provedor de IA pela chave que achar no computador e enviar código para fora.
- Conferir: `py -3 -c "import os;print(os.environ.get('GRAPHIFY_BACKEND'))"` → `none`. Se não for `none`, **pare** e avise o usuário.
- Use sempre `--code-only`. Nunca rode `extract` sem ele, nem `label`, `add`, `clone`, `watch`, `--backend` ou `--postgres`. No `cluster-only`, use sempre `--no-label`.

## Consultar (antes de abrir arquivos)
```powershell
graphify query "onde a loja calcula o frete do produto?"
graphify explain "CategoryCarousel"
graphify path "AuthForm" "verifyTurnstile"
```
- Abra só os arquivos que o mapa indicar. Ligações `INFERRED` são deduções: confirme no arquivo antes de afirmar.
- `graphify-out/GRAPH_REPORT.md` é visão geral de arquitetura: leia só ao planejar algo grande, não a cada tarefa.
- O mapa pode estar desatualizado. Se um arquivo apontado não existir ou não bater, confirme com `rg` e atualize o mapa.

## Gerar ou atualizar (na raiz do repositório)
```powershell
graphify extract . --code-only --max-workers 2   # primeira vez na máquina
graphify cluster-only . --no-label --no-viz       # gera GRAPH_REPORT.md sem IA
graphify update .                                # depois de git pull ou mudanças grandes
```
- `--max-workers 2` por causa dos 4 GB de RAM. O `.graphifyignore` da raiz já exclui dependências, builds, relatórios, skills e `.env*`.
- Não commite `graphify-out/`.

## Sem Graphify instalado
Não instale por conta própria. Use `rg`/Glob com termos específicos, como manda o `AGENTS.md`, e avise o usuário de que o mapa ajudaria. Instalação (só pelo usuário): `py -3 -m pip install graphifyy==0.9.93` e `setx GRAPHIFY_BACKEND none`.
