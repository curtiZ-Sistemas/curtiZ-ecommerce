# Autenticação

Clientes e usuários internos entram pelo mesmo endereço, `/login`, sem selecionar cargo.
Depois de validar as credenciais no Supabase Auth, o servidor consulta o perfil e o papel
vigente no banco e direciona a sessão para a área correta:

- cliente: `/minha-conta`;
- operacional: painel `/operacional`;
- administrador: painel `/administracao`;
- gerência: painel `/gerencia`;
- técnico: painel `/tecnico`.

O cadastro de clientes permanece separado em `/cadastro` e pede apenas os dados mínimos.
Endereço e CPF não fazem parte do cadastro inicial. A confirmação por e-mail usa o fluxo
PKCE do Supabase.

O navegador nunca escolhe ou informa o cargo do usuário. Contas suspensas são desconectadas
antes do redirecionamento, e operações críticas continuam sujeitas a RBAC, reautenticação e
AAL2 no servidor. Em produção, usuários internos devem usar MFA TOTP.

Convites internos usam a Admin API somente no servidor. Mudança de cargo, exportação,
reembolso, manutenção e acesso temporário a PII exigem reautenticação/AAL2 e registro de
auditoria.
