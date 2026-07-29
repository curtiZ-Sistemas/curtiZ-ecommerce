# Autenticação

Clientes usam Supabase Auth com e-mail confirmado e PKCE. Cadastro não pede endereço ou CPF. Usuários internos entram pelo painel sem selecionar cargo; o servidor identifica o papel e exige MFA TOTP em produção.

Convites internos usam Admin API somente no servidor. Mudança de cargo, exportação, reembolso, manutenção e acesso temporário a PII exigem reautenticação/AAL2.
