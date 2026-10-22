# Recuperação de senha — validação em outro navegador

Assunto preservado: **Redefina sua senha da curti Z**.

O HTML em [recovery.html](../supabase/templates/recovery.html) preserva o visual e o assunto do template **Reset password** conferido no projeto original. A nova versão substitui somente o destino do link pelo fluxo oficial de verificação de recuperação no servidor, independente do navegador da solicitação. **Publicar a aplicação antes de aplicar esta versão no Supabase.** O arquivo não aplica configuração automaticamente.

Site URL conferida: https://curtiz.com.br. A allowlist existente contém o callback da loja com suporte à query de retorno; nenhum redirect foi adicionado. O logo HTTPS existente respondeu HTTP 200. O texto continua em português. O teste completo exige o titular escolher sua senha diretamente.

## Aplicação controlada

1. No projeto original `jfnkxdzusqymsvzckerl`, conferir o assunto e HTML efetivamente publicados em Authentication → Email Templates → Reset password. Guardar a versão anterior em armazenamento privado autorizado antes de substituir. Não copiar dados SMTP ou chaves.
2. Comparar o conteúdo atual com a proposta. Para corrigir o idioma, alterar somente o assunto e conteúdo de recuperação; preservar SMTP, provedor Google, duração, URLs e demais templates.
3. Publicar primeiro os handlers `/auth/recovery` e `/api/auth/recovery/verify` e conferir seus headers de não armazenamento e isolamento. Só depois trocar o HTML hospedado pela nova versão. O link usa `https://curtiz.com.br/auth/recovery#token_hash={{ .TokenHash }}`; não colocar o token na query, em relatórios, logs ou no callback legado `/auth/callback`. Não usar `.RedirectTo` isolado. A versão anterior com ConfirmationURL permanece no painel até a publicação coordenada.
4. Confirmar a origem e o redirect permitidos no projeto sem ampliar a allowlist por conveniência. O caminho efetivo deve acompanhar `RECOVERY_PATH` em `apps/store/src/lib/password-recovery.ts`.
5. Fazer uma única solicitação pelo fluxo oficial da loja para a conta autorizada, depois da publicação e aplicação do template. O novo link pode ser aberto em outro navegador/dispositivo. Não abrir o link por automação, prévia HTTP ou relatório. Não repetir solicitações enquanto houver mensagem pendente.
6. O titular confere assunto, idioma, logo e destino; abre o link recebido mais recente e escolhe a senha diretamente. Não há etapa para digitar o e-mail novamente. O agente não muda a senha. O teste só é completo depois da conclusão pelo titular. Não registrar link/token, corpo personalizado ou senha como evidência.

## Proteções do novo fluxo

O documento isolado não carrega scripts da loja ou de terceiros. O fragmento não é enviado no GET; o script o remove imediatamente do histórico e envia o hash somente num POST da mesma origem. O GET não consome tokens. O servidor valida apenas `type=recovery` na API oficial, com limite persistente por IP confiável da Cloudflare, armazenado exclusivamente como HMAC no schema privado existente. Falhas na proteção bloqueiam a verificação.

Após a validação, uma prova assinada HttpOnly/Secure, host-only, SameSite strict e válida por 15 minutos fica vinculada à sessão exata, usuário e versão do usuário confirmados pelo Auth. Ela usa uma finalidade criptográfica separada com a chave HMAC já existente; não contém o link nem a senha. Isso permite distinguir recuperação de uma sessão OTP ou login comuns sem ampliar o acesso destas sessões. Perfil ativo, identidade de senha e MFA continuam obrigatórios. A prova é removida no sucesso; a atualização do usuário também invalida a prova anterior. O callback PKCE legado continua disponível para mensagens anteriores.

O pedido retorna uma confirmação neutra profissional e direciona ao login. E-mail em formato inválido recebe aviso específico; existência de conta, cooldown individual e respostas internas do provedor não são expostos. Isso evita enumeração de usuários. Não aumentar validade de tokens nem enfraquecer validações para mascarar falhas.

Se o link falhar, registrar somente etapa e código sanitizado. Verificar se o projeto/template são os corretos, se o link é o mais recente, se existe o verificador PKCE no navegador e o que foi retornado pelo Auth. Scanners e rastreamento são hipóteses até haver evidência; não aumentar validade, remover guardas ou migrar para outro mecanismo para mascarar o problema.

A configuração de templates hospedados é independente dos arquivos locais: [documentação oficial Supabase](https://supabase.com/docs/guides/auth/auth-email-templates). O SMTP configurado por si só não traduz o conteúdo.

## Teste dos dois e-mails comerciais

Enviar somente os dois exemplos identificados como homologação, para `sistemas.curtiz@gmail.com`, sem pedido real, alteração de estado ou claim da fila comercial. Registrar separadamente aceitação e evento de entrega do Resend. A chave idempotente deve permanecer estável em cada cenário; erro incerto exige consulta antes de novo envio. Não usar este procedimento para simular pagamento ou entrega reais. A configuração/deploy do Worker permanece sob coordenação Bling e `EMAIL_ENABLED=false`.
