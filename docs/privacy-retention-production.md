# Retenção de análise e revisão das políticas — 01/11/2026

A configuração de produção consultada indica 30 dias para eventos individualizáveis de análise. Foram encontrados 967 eventos além dessa janela e 64 perfis de interesse vencidos, em consultas agregadas sem dados pessoais. A função manual de expurgo existe, mas o Worker publicado não a agenda; `pg_cron` não está instalado.

A nova migration apenas cria índices e uma função de manutenção. Não executa exclusão ao ser aplicada. A função só admite `service_role`, respeita a configuração existente (entre 7 e 180 dias, padrão 30), remove lotes limitados e ignora linhas já bloqueadas por outro processo. Não altera pedidos, pagamentos, estoque, documentos fiscais ou indicadores agregados.

A fila `privacy_retention` usa a infraestrutura agendada existente, com transporte nativo, timeout e isolamento das outras filas. Permanece desligada sem `PRIVACY_RETENTION_ENABLED=true`. Sua ativação exige aprovação específica da eliminação de eventos/perfis vencidos, depois de a migration e o deploy serem aprovados. Desligar a flag interrompe os próximos lotes; a eliminação de dados vencidos não tem desfazer automático.

Os testes SQL usam somente fixtures e rollback. Os testes do Worker verificam a ativação explícita, isolamento das filas, autenticação de servidor, limites e falhas sem registrar dados sensíveis. O ambiente local não dispõe de Docker; a execução SQL real depende do CI.

## Informações jurídicas confirmadas

- O titular confirmou preparação e postagem em 1 a 5 dias úteis após o pagamento. A Política de Entrega foi atualizada e conferida publicamente em 01/11.
- O projeto Supabase está em `sa-east-1` (São Paulo). Isso identifica o banco principal, sem comprovar residência de todos os fluxos de suporte e suboperadores.
- A [Resend informa que seu DPA é celebrado na criação da conta, mas que não assina cláusulas específicas LGPD/ANPD](https://resend.com/security). Não foi inventado um mecanismo brasileiro de transferência internacional para preencher a minuta.
- Os contratos públicos de [Supabase](https://supabase.com/legal/customer-resources/data-processing-addendum) e [Cloudflare](https://www.cloudflare.com/cloudflare-customer-dpa/) devem ser conferidos contra os fluxos efetivamente contratados. Cláusulas europeias não comprovam automaticamente enquadramento brasileiro; conferir a [regulamentação da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).
- O código mantém a compra produtiva de kits bloqueada por homologação/fiscal. O quadro contratual comercial de representantes não foi preenchido com preços, comissões ou participantes fictícios.

Não declarar concluídas a revisão de transferências internacionais, a auditoria de armazenamento de terceiros ou a aprovação jurídica dos contratos enquanto faltarem suas evidências.
