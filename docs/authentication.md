# Autenticação

Clientes e usuários internos entram pelo mesmo endereço, `/login`, sem selecionar cargo.
Depois de validar as credenciais no Supabase Auth, o servidor consulta o perfil e o papel
vigente no banco e direciona a sessão para a área correta:

- cliente: `/minha-conta`;
- operacional: painel `/operacional`;
- administrador: painel `/administracao`;
- gerência: painel `/gerencia`;
- técnico: painel `/tecnico`.

O cadastro de clientes permanece separado em `/cadastro` e pede nome completo, e-mail,
telefone, senha e aceite dos termos. Endereço e CPF não fazem parte do cadastro inicial.
Nome e e-mail são normalizados, o telefone é persistido em E.164 e a senha precisa ter ao
menos seis caracteres, uma letra, um número e não pode ser comum, sequencial ou baseada nos
dados pessoais. As mesmas regras são executadas no navegador e na rota do servidor.

Quando o Supabase devolve uma sessão imediatamente, o perfil e o consentimento são atualizados e
o cliente segue para `/minha-conta?cadastro=sucesso`. Quando a confirmação por e-mail está ativa,
a interface não simula uma sessão: apresenta o estado de confirmação, oferece reenvio limitado
pelo Auth e conclui o PKCE em `/auth/callback`.

Login e cadastro aceitam `returnTo`/`next` somente como caminho interno. Cadastros iniciados no
checkout retornam para `/checkout`; os demais seguem para o perfil. Rotas de autenticação não são
aceitas como destino para evitar loops.

## Checkout autenticado

`ALLOW_GUEST_CHECKOUT=false` é o padrão. O `middleware.ts` protege `/checkout` e a API repete a
verificação com `auth.getUser()`, portanto esconder um botão não concede acesso. O carrinho
anônimo permanece no armazenamento local durante login, cadastro e confirmação de e-mail. Após
uma sessão real, `/api/cart/sync` chama `merge_customer_cart`: variantes iguais são reconciliadas,
quantidades respeitam o estoque e o preço é obtido novamente no banco. Um identificador do
carrinho sincronizado impede soma duplicada em novos carregamentos. Itens indisponíveis ou
alterados são informados ao cliente. Em `DEMO_MODE`, o carrinho permanece local para não misturar
SKUs fictícios com o catálogo remoto. Antes do checkout, `validate_checkout_lines` recalcula
preço, estoque e variante no servidor. Em staging, pagamento e frete `mock` só são aceitos quando
`DEMO_MODE=true`.

O navegador nunca escolhe ou informa o cargo do usuário. Contas suspensas são desconectadas
antes do redirecionamento, e operações críticas continuam sujeitas a RBAC, reautenticação e
AAL2 no servidor. Em produção, usuários internos devem usar MFA TOTP.

Convites internos usam a Admin API somente no servidor. Mudança de cargo, exportação,
reembolso, manutenção e acesso temporário a PII exigem reautenticação/AAL2 e registro de
auditoria.
