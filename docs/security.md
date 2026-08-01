# Segurança

Controles principais: RLS default-deny, CSP, validação Zod, allowlist de origem, URLs internas seguras, upload privado, idempotência, estoque bloqueado por linha, webhook assinado e consulta posterior ao provider.

Logs removem senhas, tokens, cookies, CPF e dados financeiros. Ações críticas recebem `request_id`. Nunca confie em preço, desconto, status ou permissão enviados pelo navegador.

Checklist pré-produção: executar testes RLS, secret scan, auditoria de dependências, validar buckets, habilitar MFA, configurar Turnstile/WAF, testar restauração e revisar retenção LGPD.

## Representantes e criativos

O usuário pode acumular os papéis de cliente e representante. Permissões internas são verificadas no
banco; esconder controles na interface não concede nem revoga acesso. Documentos de candidatura,
contratos e criativos permanecem em buckets privados e são entregues por URL assinada curta.

CPF é criptografado no servidor e a interface usa apenas os quatro últimos dígitos. Aplicações,
hierarquia, comissões, kits e criativos possuem RLS por propriedade ou permissão interna. Aprovações,
mudanças de status, fechamentos e downloads relevantes geram trilha auditável. O grafo de indicação
rejeita ciclos e lançamentos financeiros usam chaves de idempotência.

MFA e Turnstile podem ficar temporariamente desativados por configuração explícita, mas seu estado
deve ser exibido como não configurado. Habilitar as flags torna as respectivas credenciais e
verificações obrigatórias.
