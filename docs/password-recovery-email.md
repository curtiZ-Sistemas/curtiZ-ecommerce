# Recuperação de senha — template publicado

Assunto preservado: **Redefina sua senha da curti Z**.

O HTML em [recovery.html](../supabase/templates/recovery.html) versiona o template **Reset password** conferido no projeto original. Em 22/10/2026, assunto e corpo já estavam em português; o visual existente foi preservado. A única alteração publicada acrescentou a orientação de abrir o e-mail no mesmo navegador da solicitação, compatível com o fluxo PKCE da aplicação. O conteúdo foi relido após recarga do painel e comparado integralmente à versão salva. O arquivo não aplica configuração automaticamente.

Site URL conferida: https://curtiz.com.br. A allowlist existente contém o callback da loja com suporte à query de retorno; nenhum redirect foi adicionado. O template usa ConfirmationURL e o logo HTTPS existente, que respondeu HTTP 200. O e-mail antigo em inglês e a causa da expiração anterior não foram identificados como defeito atual; o teste completo exige o titular escolher sua senha diretamente.

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
