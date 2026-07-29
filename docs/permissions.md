# Permissões

O papel básico vem de claim administrada pelo servidor, mas `private.has_permission` valida papel, status e overrides no banco.

- Cliente: somente recursos próprios.
- Operacional: pedidos atribuídos, estoque de leitura e suporte transferido nominalmente.
- Administrador: catálogo, promoções, usuários e fila inicial de suporte.
- Gerência: financeiro, aprovações, relatórios e escalonamentos.
- Técnico: saúde, logs, integrações e chamados técnicos escalados.

Operações privilegiadas exigem AAL2, motivo, auditoria e possível segunda aprovação.
