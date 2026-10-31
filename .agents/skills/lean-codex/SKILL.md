---
name: lean-codex
description: Optimize Codex context and tool usage while preserving correctness. Use when a user explicitly asks for lower Codex consumption on repository investigation, coding, debugging, testing, or review.
---

# Lean Codex — eficiência sem atalhos perigosos

Objetivo: concluir **toda a tarefa solicitada** com menor consumo de contexto e chamadas redundantes, sem trocar o modelo, diminuir o esforço de raciocínio escolhido, cortar requisitos ou omitir verificações necessárias.

1. **Escopo antes da leitura.** Extraia objetivo, critérios de aceite e áreas prováveis. Use o contexto existente e as instruções do repositório. Não faça um inventário completo por padrão; em mudanças arquiteturais, auditorias ou falhas sistêmicas, amplie a análise até cobrir as dependências relevantes.
2. **Descoberta progressiva.** Identifique arquivos por nomes, imports, rotas, símbolos, `git diff` e busca direcionada. Leia trechos relevantes primeiro; abra arquivos completos quando a compreensão exigir. Evite dumps de diretórios, builds, logs ou arquivos gerados. Ignore `node_modules`, `.next`, `dist`, `build`, artefatos e segredos nas buscas quando possível.
3. **Não repita trabalho.** Antes de reler ou repetir comando/pesquisa, use resultados já válidos desta execução. Reexecute quando algo mudou, um resultado falhou, está incompleto ou surgiu hipótese nova.
4. **Ferramentas só quando ajudam.** Prefira comandos locais e saídas concisas. Use navegador, buscas externas, MCPs ou subagentes apenas com necessidade identificada; não tente alterar automaticamente configurações globais de MCP. Consulte documentação atual quando compatibilidade, segurança ou versões importarem.
5. **Mudanças focadas.** Faça a menor alteração **correta e suficiente** para cumprir os critérios, respeitando o estilo do projeto. Não inclua refatoração, documentação extensa ou melhorias não solicitadas. Se um problema relacionado impedir a tarefa, corrija-o com justificativa.
6. **Testes proporcionais e completos quando necessário.** Comece pela verificação relevante; amplie para testes de integração, build, lint, segurança, fluxos críticos ou regressão conforme risco e impacto. Jamais pule testes importantes apenas para poupar tokens. Registre falhas preexistentes separadamente.
7. **Comunicação enxuta.** Não despeje logs completos ou raciocínio repetido. Informe somente decisões materiais, bloqueios e resultado. Na entrega: o que mudou, verificações executadas/resultados e pendências reais.
8. **Conclusão e segurança.** Não encerre antes dos critérios de aceite. Não presuma sucesso sem evidência, não invente testes e nunca exponha segredos. Respeite as autorizações existentes para alterações, deploys, escrita externa e ações destrutivas.

**Prioridade:** qualidade, segurança e escopo > economia. Esta skill não altera limites da conta, nem garante economia percentual ou qualidade idêntica em todas as tarefas.
