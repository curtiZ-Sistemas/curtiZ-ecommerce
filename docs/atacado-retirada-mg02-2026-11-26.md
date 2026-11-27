# Retirada MG02 — decisão técnica e pendência fiscal (26/11/2026)

O responsável solicitou incluir o endereço de retirada nas informações complementares, mantendo o Bling. O texto esperado para a natureza 15111975260 (série 003, CEP de expedição 35524168) é:

Local de retirada das mercadorias: Rua Antônio Pedro da Silva, nº 753, bairro Romeu Duarte, Nova Serrana/MG, CEP 35524-168.

- Acrescentar na natureza e verificar em um rascunho legítimo; preservar textos do Simples Nacional e IBPT. Não alterar o endereço do emitente nem preferências globais.
- O schema OpenAPI Bling v3 NotasFiscaisDadosPostDTO declara observacoes como writeOnly; o GET não documenta esse campo. Não forçar PUT que poderia sobrescrever observações já existentes, nem inventar uma confirmação da API.
- A prévia do painel mostra o texto esperado e o distingue explicitamente dos dados efetivamente consultados. A conciliação automática da venda de atacado confere a observação no XML autorizado para esta natureza e CEP, além das validações existentes. A validação estruturada da retirada foi mantida.
- O RICMS/MG 2023, Anexo V, disposição sobre DANFE, § 2º, IV, prevê o grupo específico da NF-e nos casos de local de entrega ou retirada diverso do endereço do destinatário. A orientação anterior foi relatada pelo responsável, mas não há neste relatório confirmação escrita que esclareça a aplicabilidade/exceção para este caso. Não considerar infCpl um substituto fiscal comprovado.
- Antes da transmissão real: confirmar com a contabilidade, considerando esse dispositivo, se é suficiente infCpl para saída física de Nova Serrana com entrega própria; se o grupo estruturado for necessário, obter meio suportado pelo emissor. A autorização técnica não prova conformidade. Não criar nova nota para testar ou contornar uma autorização existente.
- A série 004, pagamento, cancelamentos e homologação de ponta a ponta continuam sujeitos à verificação real; nenhuma nota transmitida ou excluída neste trabalho.

Fontes: https://developer.bling.com.br/build/assets/openapi-Dfpp2fup.json ; https://ajuda.bling.com.br/hc/pt-br/articles/360036361433-Como-preencher-as-Informa%C3%A7%C3%B5es-Adicionais-na-nota-fiscal ; https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexov2023_2.html
