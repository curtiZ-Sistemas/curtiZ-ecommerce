# Relatório de homologação — kits para revenda

- Foi localizado registro privado de uma NF-e de homologação preparada manualmente para um kit de dois pares em operação dentro de MG. Essa evidência cobre apenas o caso descrito no registro, não comprova correção fiscal geral nem o fluxo automatizado.
- Em execução anterior, 63 testes automatizados dos módulos existentes de catálogo, prévia e transações TEST passaram. São testes de software e não demonstram pagamento real, emissão ou expedição de ponta a ponta.
- Nesta alteração, passaram 32 testes em dois arquivos direcionados à prévia de revenda e à respectiva API; também passaram o ESLint dos arquivos alterados e o TypeScript da loja. A prévia aceita um cenário explicitamente declarado apenas para conferência, não o persiste nem valida tributação, não cria pedido e mantém `canPurchase=false`.
- Para o vínculo de declaração ao pedido TEST, passaram 48 testes direcionados de transações, prévia e biblioteca; ESLint e TypeScript da loja também passaram. A validação do comportamento transacional no banco depende do CI desta revisão.
- A migration de regras versionadas foi aplicada em banco temporário no CI do PR 136: lint do banco e contratos SQL passaram. Os testes cobrem ausência de aprovação, divergência de cenário, validade, conflito de versões, revogação e restrições de acesso. Nenhuma regra real foi cadastrada nem o banco produtivo foi alterado. A consulta retorna apenas um candidato e não habilita operações comerciais.
- Não foi realizada nesta alteração cobrança real, emissão de NF-e, compra de etiqueta ou mudança de configuração global do Bling.
- Pendente: validação em ambiente isolado de pagamento, estoque, integração de pedidos, nota e expedição, incluindo falhas, concorrência, conciliação e reprocessamento.
