# Autenticador removido

O produto não oferece cadastro, verificação ou opção de ativação de autenticador TOTP. Links antigos /mfa retornam ao login. Sessões, perfis ativos, papéis, permissões, limites de tentativas, proteção de origem, RLS e auditoria são preservados.

A migration incremental impede reativar o antigo parâmetro interno e remove sua influência nos helpers de autorização. Estruturas históricas privadas e migrations aplicadas permanecem para preservar histórico; não são opções do produto. TOTP enrollment/verification ficam desativados no provedor.
