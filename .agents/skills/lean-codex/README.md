# Lean Codex — instalar e usar

Uma skill **personalizada**, produzida com base nas boas práticas públicas da OpenAI; **não é uma skill oficialmente publicada nem auditada pela OpenAI**. Contém somente instruções em Markdown, sem código executável, conexões, APIs ou acesso a segredos.

## Instalação para todos os repositórios (Codex local/IDE)

Extraia o ZIP. Copie a pasta `lean-codex` com `SKILL.md` para:

- Windows: `%USERPROFILE%\.agents\skills\lean-codex\SKILL.md`
- macOS/Linux: `~/.agents/skills/lean-codex/SKILL.md`

No PowerShell, se o ZIP foi extraído para Downloads:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills\lean-codex" | Out-Null
Copy-Item "$HOME\Downloads\lean-codex\SKILL.md" "$HOME\.agents\skills\lean-codex\SKILL.md"
```

No macOS/Linux, dentro da pasta onde o ZIP foi extraído:

```bash
mkdir -p ~/.agents/skills/lean-codex
cp lean-codex/SKILL.md ~/.agents/skills/lean-codex/SKILL.md
```

Reinicie o Codex ou recarregue as skills, quando a interface permitir.

## Só em um projeto

Coloque a pasta em `<raiz-do-projeto>/.agents/skills/lean-codex/`, preservando o `SKILL.md`.

## Uso

Em uma nova conversa do Codex, peça:

```text
Use a skill $lean-codex. Implemente [descreva a tarefa] integralmente. Mantenha o modelo e o nível de raciocínio selecionados; economize leituras redundantes e chamadas desnecessárias, mas preserve os testes e a qualidade.
```

Se a skill não aparecer no seletor, confira o caminho e a versão do Codex; a descoberta de skills pode variar entre aplicativos e ambientes.

## Para economizar mais

- Enxugue instruções repetidas em `AGENTS.md` e skills desnecessárias.
- Desabilite servidores MCP que não serão usados naquela tarefa, quando for viável.
- Divida solicitações independentes em trabalhos de escopo claro, sem perder critérios de aceite.
- Compare resultados em tarefas representativas; a economia não é garantida e varia por contexto.

Fontes de referência:
- https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra
- https://developers.openai.com/pt-BR/docs/pricing
- https://developers.openai.com/plugins/build/skills
