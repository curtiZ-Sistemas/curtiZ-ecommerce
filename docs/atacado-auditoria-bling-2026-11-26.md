# Conferência das preferências do Bling — 26/11/2026

Evidência visual: configurações NF-e fornecidas pelo responsável. Não equivale a homologação da integração.

- Ambiente 1 (produção), leiaute 4.00; certificado A1 no servidor, válido até 31/07/2027, CNPJ do emitente coincide com a regra MG02.
- Controle de numeração: 001 próximo 2, 002 próximo 6, 003 próximo 3. Série 004 não exibida; não definir número manualmente nem inferir que nunca foi usada.
- Lançamento automático de estoque e contas na emissão/cancelamento de NF-e desativado, assim como emissão automática após geração em lote. Preservar. Verificar separadamente lançamentos por pedido e situação dos rascunhos anteriores.
- Frete padrão CIF (0) global. Não alterar o varejo: atacado MG02 exige modalidade 3 na nota, sem cobrar frete.
- Identificação do local de entrega/retirada desativada. Habilitar na interface após validar impacto; conferir o campo na nota pendente. A preferência não comprova que a API preencha o grupo retirada. O XML autorizado precisa passar a verificação existente do CEP de origem; não reduzir essa validação nem transmitir venda de teste em produção.
- Natureza venda sem crédito ID 15111975260, série 003, confirmada no cadastro interno. Não liberar a natureza de crédito sem validação própria. A natureza de devolução própria registrada na regra interna tem ID 15111772281; sua configuração ativa no Bling e a série 004 não foram comprovadas nestes prints.
- Os registros anteriores permanecem vinculados à versão fiscal antiga. A chave de acesso em um rascunho não prova autorização, mas exige conciliação antes de exclusão. Não forçar estorno, exclusão ou reemissão.
- Próximos itens: dados fiscais dos produtos, informações complementares, configurações dos pedidos/estoque, dados cadastrais do estabelecimento, XML autorizado e status dos rascunhos. Testar comunicação SEFAZ e validar uma operação legítima em condições apropriadas.

Referências: https://ajuda.bling.com.br/hc/pt-br/articles/360036761374-Excluir-uma-nota-fiscal ; https://ajuda.bling.com.br/hc/pt-br/articles/29781843928471-Por-que-n%C3%A3o-consigo-editar-a-nota-fiscal-no-Bling ; https://developer.bling.com.br/referencia .
