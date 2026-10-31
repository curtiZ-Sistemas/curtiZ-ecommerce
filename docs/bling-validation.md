# Bling: relatório da implementação e validação

Data: 2 de outubro de 2026. A integração foi implementada com todas as flags comerciais desabilitadas por padrão. Não houve conexão autenticada real ao Bling, escrita comercial, emissão fiscal, migração de produção, envio de e-mail, push ou deploy.

## Código entregue

| Área | Entrega | Base reutilizada |
| --- | --- | --- |
| Integrações compartilhadas | Cliente Bling server-only, OAuth/JWT, tokens criptografados, refresh com lock/CAS, HTTP centralizado, documentos e notificação real via Resend | Pacote integrations e contratos privados de OAuth |
| Supabase | Migration incremental `202610020001_bling_integration.sql`: vínculos, orçamento HTTP compartilhado, eventos, jobs, histórico, permissões e política fiscal de expedição | RLS, RBAC/MFA, background_jobs, pagamentos e estoque existentes |
| Store/Worker | Webhook assinado e persistente; processamento de catálogo, saldo físico, vendas pagas, NF-e e conciliação; download protegido; bloqueio fiscal no Melhor Envio | Snapshots do checkout, CPF criptografado, confirmação Mercado Pago, shipments e cron |
| Panel | Conexão/configuração técnica; prévia paginada de SKU; pendências e histórico operacional; estados por variante; resumo gerencial | Navegação, papéis, permissões e componentes existentes |
| Cliente | Disponibilidade verdadeira da nota e download autenticado para o dono ativo do pedido | Área de pedidos existente |

O catálogo e o estoque físico permanecem sob autoridade do Supabase. Reservas não geram outra baixa física no Bling. Mercado Pago continua sendo a autoridade de pagamento; os retornos ERP não adicionam faturamento. Cancelamento/estorno local gera conciliação, sem cancelamento fiscal silencioso.

## Verificações executadas

- **Testes relacionados:** execução sequencial de 88 arquivos e 380 testes aprovados, incluindo integrações compartilhadas, Bling, documentos, callbacks, Mercado Pago, housekeeping, Melhor Envio e verificações SQL estáticas. Testes SQL estáticos não comprovam execução de RLS ou concorrência.
- **Revisão final:** 7 arquivos e 69 testes aprovados para cliente Bling, Resend, webhook, documento, snapshots/conciliação e autorização dos painéis. A revisão acrescentou cenários de sessão inativa, cliente sem papel interno, MFA, permissão técnica e registros externos conflitantes. APIs simuladas foram usadas somente nos testes.
- **Orquestração do Worker:** mais 5 testes aprovados em arquivo próprio, cobrindo conciliação sem nova escrita externa, conflito de registros, perda de lease, flags comerciais desligadas e credenciais ausentes/revogadas. Esses testes usam banco/provedor simulados e não comprovam locks entre conexões reais.
- **Typecheck:** packages/integrations, panel e store; verificação adicional do TypeScript do custom Worker, que não é incluído pelo typecheck habitual do Next.
- **Lint:** arquivos novos e fluxos alterados, sem silenciar regras.
- **Build Next:** store e panel aprovados com um worker. A verificação de exposição de dados nos assets do navegador passou em ambos. Não equivale a uma auditoria completa de segredos.
- **Bundle independente do cron:** esbuild compilou o custom Worker com o handler HTTP gerado pelo OpenNext tratado como externo. Confirma a compilação desse código, sem comprovar o bundle Cloudflare final.
- **Layout:** fixture de teste com os componentes React Bling e CSS real do painel, em 320, 360, 390, 430, 768, 1024 e 1440 px; sem rolagem horizontal. Verificados preview, carregamento de ações, texto longo, erro e recuperação. Evidência local em `.playwright-mcp/bling-320.png`. A fixture usa respostas simuladas e não valida o fluxo autenticado completo nem a tipografia final do Next.
- **Diff:** revisão dos arquivos e `git diff --check`. Alterações preexistentes em `docs/deployment.md` e arquivos de instruções gerados foram preservados fora do commit da integração.

## Bloqueios confirmados

1. **PostgreSQL local indisponível:** `pnpm exec supabase test db supabase/tests/bling_integration_test.sql` falhou ao conectar ao banco local. A migration não foi aplicada e os testes pgTAP não foram executados. São necessários antes de ativar a integração; incluem permissões/RLS, idempotência, pagamento elegível, observações fora de ordem, estoque, leases e política fiscal. A contenção entre conexões concorrentes também precisa de verificação com PostgreSQL disponível.
2. **OpenNext no Windows:** o build Next interno foi concluído; a etapa OpenNext falhou com `EPERM` ao criar symlink de `@next/env`, inclusive com execução fora do sandbox. Validar o bundle final em WSL/Linux ou CI antes de deploy. Não foram alterados runtime, adaptador ou versões para contornar o bloqueio.
3. **Provedores/configuração real:** faltam validação autorizada da conta OAuth, escopos, revogação, depósito e forma de pagamento, cadastro fiscal/certificado/SEFAZ, entrega de webhook e aceitação/entrega Resend. Testes com mocks não comprovam esses contratos em operação real.

## Sequência controlada antes da ativação

1. Aplicar as migrations em Supabase isolado, executar pgTAP e verificar concorrência de refresh, limiter e jobs com conexões distintas. Testar acesso direto com papéis de cliente, operador e técnico.
2. Concluir OpenNext e as verificações de assets em Linux/CI. Manter flags desabilitadas e revisar a configuração de cada Worker.
3. Seguir [o guia de configuração](bling.md): aplicativo privado, escopos, callback/webhook, secrets e conta autorizada. Conferir o status técnico e testar reconexão/revogação sem operações comerciais.
4. Validar preview e vínculos por SKU em conta/dados autorizados. Ativar catálogo/estoque/pedidos separadamente e observar a fila; conferir saldo físico, referências e ausência de duplicatas.
5. Com autorização específica para dados e emissão reais, conferir pré-condições fiscais com empresa/contador. Testar rascunho, retorno autorizado/rejeitado, política de expedição e documentos do cliente; só então considerar a flag de envio fiscal. Testar Resend separadamente com remetente verificado.

Falha de ERP não desfaz pagamento local. Resultado incerto mantém a operação bloqueada até consulta/conciliação; registros não encontrados exigem conferência manual. O estado “e-mail aceito” depende de ID real do Resend e não significa entrega na caixa postal.
