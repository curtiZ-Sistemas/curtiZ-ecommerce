---
name: equipe-leve-temporaria
description: Skill TEMPORÁRIA para executar um plano de docs/planos/ com uma equipe de 3 papéis (coordenador, implementador, verificador), cada um com um modelo diferente, um de cada vez, para economizar tokens e não pesar o computador (4 GB de RAM). Use só quando o usuário pedir para executar um plano com a equipe.
---
# Equipe leve (temporária)

Vale só para planos em `docs/planos/` que o usuário mandou executar. Remova esta pasta quando o plano estiver concluído (registre a remoção no plano). O `AGENTS.md` prevalece: esta skill só pode ser usada por pedido explícito do usuário, que é o que autoriza os subagentes.

## Papéis e modelos

| Papel | Faz | Não faz | Claude Code (`model` do subagente) | Codex e outras ferramentas |
|---|---|---|---|---|
| **Coordenador** | Lê o plano, entrega uma tarefa por vez, escreve especificações, revisa diffs (segurança, design e direção), atualiza a tabela de progresso e fala com o usuário | Implementar código; ler o projeto inteiro | `opus` (sessão principal) | Modelo mais forte disponível, com raciocínio alto |
| **Implementador** | Executa **uma** tarefa de implementação com a lista de arquivos recebida e roda os testes específicos dela | Mudar o escopo; abrir arquivos fora da lista sem consultar o mapa; commit | `sonnet` | Modelo padrão, com raciocínio médio |
| **Verificador** | Capturas de tela, testes, typecheck, lint e checklists (`web-design-guidelines`, `accessibility`, `break-ui`); relata `arquivo:linha` | Corrigir código; opinar sobre gosto | `haiku` | Modelo mais leve, com raciocínio baixo |

Ferramentas sem subagentes (por exemplo, o Codex em uma única sessão): rode cada papel em uma **sessão separada**, escolhendo o modelo da tabela, e passe a ele só o "pacote da tarefa" abaixo. A troca de informação acontece pelo arquivo do plano, não pela conversa.

## Pacote da tarefa (o que o coordenador entrega)

O pacote tem no máximo 15 linhas. Nada além disso vai para o subagente:
1. o id e o título da tarefa, copiados do plano;
2. os arquivos exatos, obtidos com `graphify query`, `explain` ou `path` pelo coordenador;
3. as skills a ler (só as citadas na tarefa) e as seções delas;
4. o critério de pronto e os comandos de verificação;
5. as proibições: fora do escopo, commit, push, deploy, dependências novas e dados inventados.

O subagente responde em no máximo 8 linhas: o que fez, os arquivos alterados, os comandos executados com o resultado e as pendências. Logs completos não entram na resposta.

## Leveza (obrigatória)

- **Um agente por vez.** Nunca em paralelo. O próximo só começa depois que o anterior terminar e o coordenador registrar o resultado.
- **No máximo um servidor local**, iniciado pelo verificador e encerrado ao fim da tarefa. Não deixe processos abertos entre tarefas.
- Testes: `vitest run <arquivos>` com `--maxWorkers=1`. Typecheck só do workspace afetado. Sem `pnpm check` global, build completo ou e2e inteiro, salvo se a tarefa exigir.
- Capturas só nas larguras pedidas pela tarefa, salvas fora do repositório (pasta temporária do sistema). Leia o relatório antes de abrir imagens.
- O Graphify não roda dentro de subagentes. O coordenador atualiza o mapa (`graphify update .`) entre fases, se o código mudou muito.
- Leitura: só os arquivos do pacote. Arquivo grande se lê por trechos (`rg -n` + intervalo de linhas).

## Ciclo

1. O coordenador lê o plano e escolhe a próxima tarefa "a fazer" cujas dependências estejam prontas.
2. Ele monta o pacote e chama o papel indicado na coluna "Modelo" (forte = coordenador, padrão = implementador, leve = verificador).
3. Ao receber a resposta, confere a evidência. Se faltar evidência, devolve uma vez com o que falta; na segunda falha, para e avisa o usuário.
4. Atualiza a linha na tabela de progresso (status e evidência em 1 linha).
5. Nas tarefas marcadas "parar e pedir aprovação", espera o usuário antes de seguir.
6. No fim, faz a revisão do diff (tarefa de revisão do plano) e entrega ao usuário um resumo curto. Commit, push, migration e deploy só com pedido explícito.
