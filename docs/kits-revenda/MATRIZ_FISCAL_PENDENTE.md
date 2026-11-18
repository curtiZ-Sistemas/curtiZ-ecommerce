# Matriz fiscal — kits para revenda

A cobertura comercial solicitada é nacional. Os parâmetros abaixo são referências registradas e nenhuma linha está liberada para emissão automática em produção.

| Destinatário | Destino | Referência registrada | Decisão ainda pendente |
| --- | --- | --- | --- |
| Pessoa física | MG / demais UFs | 5102 / 6102 como referência de revenda | Elegibilidade para revenda, condição perante ICMS e exceções de destino. |
| MEI | MG / demais UFs | 5102 / 6102 como referência de revenda | Elegibilidade, IE ou dispensa e tratamento por UF. |
| Pessoa jurídica contribuinte | MG / demais UFs | 5102 / 6102. CSOSN 102 se sem crédito, 101 quando elegível. | Aprovação do cenário e da natureza no Bling. Para 101, comprovar elegibilidade e percentual da competência. |
| Pessoa jurídica não contribuinte ou com inscrição dispensada | MG / demais UFs | Avaliação específica de revenda | Classificação do cenário e natureza aplicável. O 6108 registrado para B2C não serve como padrão de revenda. |
| Devolução de revendedor | MG / demais UFs | Série 003 para devoluções já documentadas | Emissor e natureza da devolução, totais/parciais, referência à nota original e tratamento fiscal. As referências de B2C PF não se estendem à revenda. |

- **Orientação registrada em 24/10/2026.** Venda para revenda com `finalConsumer=false`, presença 2, e CFOPs de referência 5102 em MG e 6102 interestadual. O NCM 64022000 e os parâmetros tributários descritos na política valem como referência para os produtos documentados. [Política fiscal](../fiscal-policy-2026-10-24.md)
- **Vigência.** Crédito de 1,36% foi registrado apenas para operações elegíveis de outubro de 2026. Para novembro e competências posteriores, é necessária a definição do percentual se houver crédito. [Conferência de 01/11/2026](../bling-producao-2026-11-01.md)
- **Implementação técnica existente.** Catálogo, prévia e transações de teste de kits. O estoque fica no SKU comercial com unidade UN, e a composição fiscal cadastrada usa pares em PR. A conferência de 01/11 registrou 162 SKUs e 372 componentes. [Conferência de 01/11/2026](../bling-producao-2026-11-01.md)
- **Homologação.** Existe registro de uma NF-e de kit de dois pares preparada manualmente em homologação. O registro cobre aquele documento e não comprova o fluxo automatizado de revenda ou autorização dos demais cenários.
- **Produção.** Falta identificar, para cada cenário permitido, a natureza ativa de revenda no Bling e a vigência da aprovação, incluindo exceções por UF e produto, tributos aplicáveis e devoluções. A integração comercial permanece fechada. A origem logística registrada é Nova Serrana/MG e permanece separada do endereço fiscal.

## Naturezas consultadas no Bling

| Cadastro | CFOP exibido | ID Bling | Uso produtivo |
| --- | --- | --- | --- |
| Homologação MG, não consumidor final | 5102 | `15111725693` | Pendente de vinculação e aprovação para revenda. |
| Homologação interestadual, contribuinte não consumidor | 6102 | `15111725714` | Pendente de vinculação e aprovação do perfil, do crédito e das UFs aplicáveis. |
| Homologação, não contribuinte não consumidor | 6108 | `15111725713` | Cadastro de teste com CSOSN 102 e regra genérica de destino e produto. A aplicabilidade à revenda por UF e perfil segue pendente. |
| Homologação de devolução PF em MG | 1202 | `15111772281` | Cadastro de referência para devolução PF. Falta definir a devolução de kits para revenda. |
| Homologação de devolução PF interestadual | 2202 | `15111772282` | Cadastro de referência para devolução PF. Falta definir a devolução de kits para revenda. |

Consulta somente de leitura no Bling em 18/11/2026. Os registros de homologação acima continuam pendentes de aprovação para uso no fluxo produtivo de kits.

