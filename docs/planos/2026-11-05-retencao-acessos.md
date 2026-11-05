# Registros de acesso e transparência dos fornecedores

Objetivo: completar as informações verificáveis de Cloudflare/Supabase na minuta e implementar guarda mínima de acessos processados pelos Workers por seis meses, sem alterar consentimentos em trabalho por outro agente.

1. Confirmar contratos, papéis, destinos e retenção documentados; separar operação real de listas globais dos fornecedores.
2. Adicionar tabela privada e RPCs exclusivas de serviço, com idempotência, retenção de seis meses, preservação legal e expurgo em lotes; testar permissões e limites em pgTAP no CI.
3. Registrar somente IP validado do cabeçalho da Cloudflare, instante e aplicação nos dois Workers; usar transporte nativo, repetição limitada e waitUntil, sem bloquear a compra. Integrar expurgo ao agendamento existente da loja, independente das outras filas.
4. Executar testes específicos/CI, aplicar migration validada, publicar pelo workflow oficial e comprovar gravação/isolamento/expurgo por agregados; atualizar a minuta pelo painel e o registro.

Arquivos: packages/security/src/application-access-log.ts e testes; exports do pacote; apps/store/custom-worker.ts; apps/panel/custom-worker.ts; Wrangler dos dois apps; scripts/custom-worker.test.ts e teste do wrapper do painel; migration incremental e pgTAP. Sem novas dependências, serviços pagos, leitura de segredos ou mudança de consentimentos.

Limites: não reconstruir registros anteriores à ativação; não afirmar captura de tráfego bloqueado ou servido fora dos Workers. Uma falha persistente de transporte pode impedir gravação após as tentativas limitadas e precisa de acompanhamento operacional. A implementação não substitui o mecanismo jurídico das transferências internacionais.
