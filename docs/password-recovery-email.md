# Recuperação de senha — template para revisão

Assunto proposto: **Redefina sua senha · curti Z**.

O HTML em [recovery.html](../supabase/templates/recovery.html) é uma proposta para o template **Reset password** do Supabase Auth. Reutiliza logo, cores, tipografia e estrutura do e-mail transacional existente. Não é um novo tipo comercial. Não foi publicado nem vinculado automaticamente ao config local ou ao projeto hospedado.

## Aplicação controlada

1. No projeto original `jfnkxdzusqymsvzckerl`, conferir o assunto e HTML efetivamente publicados em Authentication → Email Templates → Reset password. Guardar a versão anterior em armazenamento privado autorizado antes de substituir. Não copiar dados SMTP ou chaves.
2. Comparar o conteúdo atual com a proposta. Para corrigir o idioma, alterar somente o assunto e conteúdo de recuperação; preservar SMTP, provedor Google, duração, URLs e demais templates.
3. Preservar `{{ .ConfirmationURL }}`. A aplicação solicita recuperação via `resetPasswordForEmail` com redirect para `/auth/callback?next=/redefinir-senha`; o servidor troca o código PKCE pela sessão e confere a autenticação recente de recuperação. Não substituir o link por `.RedirectTo` isolado, nem incluir `.TokenHash` num callback que só aceita `code`.
4. Confirmar a origem e o redirect permitidos no projeto sem ampliar a allowlist por conveniência. O caminho efetivo deve acompanhar `RECOVERY_PATH` em `apps/store/src/lib/password-recovery.ts`.
5. Fazer uma única solicitação pelo fluxo oficial da loja para o destinatário autorizado, no navegador em que ele abrirá o link. Não abrir o link por automação, prévia HTTP ou relatório. Não repetir solicitações enquanto houver mensagem pendente.
6. O titular confere assunto, idioma, logo e destino; abre o link recebido mais recente no mesmo navegador e escolhe a senha diretamente. O agente não muda senha nem invalida sessões. O teste só é completo depois da conclusão pelo titular. Não registrar link/token, corpo personalizado ou senha como evidência.

Se o link falhar, registrar somente etapa e código sanitizado. Verificar se o projeto/template são os corretos, se o link é o mais recente, se existe o verificador PKCE no navegador e o que foi retornado pelo Auth. Scanners e rastreamento são hipóteses até haver evidência; não aumentar validade, remover guardas ou migrar para outro mecanismo para mascarar o problema.

A configuração de templates hospedados é independente dos arquivos locais: [documentação oficial Supabase](https://supabase.com/docs/guides/auth/auth-email-templates). O SMTP configurado por si só não traduz o conteúdo.

## Teste dos dois e-mails comerciais

Enviar somente os dois exemplos identificados como homologação, para `sistemas.curtiz@gmail.com`, sem pedido real, alteração de estado ou claim da fila comercial. Registrar separadamente aceitação e evento de entrega do Resend. A chave idempotente deve permanecer estável em cada cenário; erro incerto exige consulta antes de novo envio. Não usar este procedimento para simular pagamento ou entrega reais. A configuração/deploy do Worker permanece sob coordenação Bling e `EMAIL_ENABLED=false`.
