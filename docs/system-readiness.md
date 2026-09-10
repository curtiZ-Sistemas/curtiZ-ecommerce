# Preparação funcional e de segurança

Esta revisão corrige problemas específicos; não certifica todos os fluxos nem a configuração de produção. Não modifica layout ou lógica de pagamento.

## Dependências que não devem ser simuladas

- **Anexos do atendimento:** só são disponibilizados quando marcados como limpos. É necessário configurar/validar um processador de análise. Não liberar arquivos pendentes para contornar a ausência desse serviço.
- **Filas técnicas:** recolocar um registro em `pending` não executa a tarefa. É necessário consumidor real com concorrência controlada, tentativas limitadas, idempotência e observabilidade. Pagamentos continuam no trabalho separado.
- **MFA interno:** há validação condicionada a `REQUIRE_INTERNAL_MFA`. Preparar cadastro e recuperação dos fatores, testar cada papel e então habilitar. Não ativar cegamente e bloquear a equipe.
- **Backup:** seguir [o procedimento de backup](backup-and-recovery.md). Cópias manuais não exigem servidor próprio; automação e teste de recuperação precisam de armazenamento e ambiente reais.
- **Catálogo:** a migration `202609100001_catalog_available_variants.sql` precisa passar pelos testes reais do banco antes de aplicação. Não foi aplicada automaticamente.

## Critérios de aceite por painel

São próximos passos de validação, não afirmações de que todos os recursos estão ausentes.

| Área | Validar com usuários e dados isolados |
| --- | --- |
| Administrativo | Permissões de catálogo e clientes; publicação de produtos completos; histórico de alterações sensíveis; falhas de upload/edição; restrição de exportações e dados pessoais. |
| Operacional | Transições de pedidos; separação; expedição; divergências; devoluções; disputa simultânea de estoque e reservas; identificação do responsável. |
| Gerencial | Indicadores conciliados com pedidos; períodos e cancelamentos; separação de funções nas aprovações; relatórios restritos. Revisão financeira depende do trabalho separado de pagamentos. |
| Técnico | Serviços e erros parciais; acessos; MFA; auditoria; consumidores de filas; evidências de backup e restauração. |
| Representante | Isolamento entre representantes; acesso à equipe autorizada; metas, comissões, kits e pedidos consistentes; nenhuma confirmação financeira fictícia. |
| Cliente | Conta, endereços, pedidos, favoritos, avaliações, devoluções, notificações e atendimento; recuperação de acesso; saída de sessão; preservação dos formulários em falhas. Lista de dispositivos e gestão de MFA exigem integração real antes de serem anunciadas como disponíveis. |

Antes de produção, executar RLS e autorização no banco isolado, incluindo tentativas entre usuários e papéis distintos. Testes de interface e análises estáticas não comprovam isolamento do banco, concorrência, entrega de e-mail ou funcionamento de serviços externos.

## Validação desta etapa

- 30 testes direcionados e 168 testes estáticos aprovados.
- Typecheck da loja e dos painéis e lint dos arquivos alterados aprovados.
- Testes SQL preparados, mas não executados: banco local inacessível.
- Dois cenários Playwright adicionados (retry do catálogo e falha/reenvio de endereço). A execução foi bloqueada pelo timeout de inicialização do servidor local; os cenários ainda precisam ser validados.
- Sem aplicação de migration, deploy, alteração de pagamento ou cópia real de dados.
