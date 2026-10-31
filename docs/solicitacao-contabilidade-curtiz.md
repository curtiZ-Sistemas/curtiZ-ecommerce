# O que pedir à contabilidade para liberar a curti Z

Preparado em 15/10/2026. Esta lista pede a validação do contador; não define códigos, impostos ou alíquotas.

Atualização de 16/10: os dados empresariais e orientações iniciais já foram recebidos por canal privado. Não é necessário reenviar razão social, CNPJ, inscrição estadual, sede ou cidade de expedição. Os itens abaixo também servem à conferência técnica; a mensagem foi reduzida às decisões ainda abertas. O pacote privado não faz parte deste repositório.

## Mensagem pronta para enviar

> Olá! Precisamos da confirmação expressa do tratamento fiscal das atividades efetivamente realizadas pela empresa. As orientações iniciais de CFOP e CSOSN atendem a essas atividades? Qual CFOP interestadual se aplica em cada situação? Há necessidade de ajuste cadastral, inscrição ou tratamento tributário específico, inclusive IPI? O contexto operacional e a pergunta específica estão no registro interno compartilhado com a empresa.
>
> Também precisamos definir inequivocamente a regra interestadual e a unidade por produto; confirmar classificação, origem, CEST e custo por SKU/documento; e conferir certificado, credenciamento SEFAZ, série, numeração e procedimentos de devolução, cancelamento e rejeição. A natureza de operação deve corresponder a cada cenário, sem uma regra estadual aplicada a todo o país.
>
> Por favor, respondam à lista abaixo, indicando o que já está pronto, o que falta e quem fará cada configuração. Ao concluir, enviem uma aprovação por escrito com a data e os cenários autorizados. A emissão automática está desligada e só será ativada após essa validação. Não enviem senhas ou certificados por mensagens abertas; esses itens devem ser configurados diretamente no ambiente seguro combinado com a empresa.

## Lista para o contador preencher

### 1. Empresa e autorização para emitir

- [ ] Confirmar razão social, CNPJ, inscrição estadual, endereço fiscal, município e UF nos cadastros da empresa e do Bling.
- [ ] Confirmar o regime tributário e o CRT correto. **CRT** é o código do regime tributário usado na nota.
- [ ] Confirmar quais mercadorias são de fabricação própria e se também haverá revenda de produtos de terceiros.
- [ ] Confirmar se os cadastros e atividades da empresa permitem as operações pretendidas.
- [ ] Confirmar credenciamento e situação para emissão de NF-e na SEFAZ, em homologação e produção, conforme aplicável. **SEFAZ** é a Secretaria da Fazenda do estado.
- [ ] Verificar certificado digital compatível com a emissão pretendida, validade e instalação no Bling. Informar quem ficará responsável por renová-lo; não colocar arquivo ou senha nesta lista.
- [ ] Definir e conferir série e numeração da NF-e, considerando eventuais emissões anteriores, para evitar duplicidade.

### 2. Natureza de operação no Bling

**Natureza de operação** é a configuração que informa ao Bling como tratar fiscalmente uma venda, devolução ou outra movimentação. O contador deve defini-la; a equipe técnica identifica seu ID no sistema depois.

- [ ] Configurar e informar o **nome exato da natureza de venda** aprovada no Bling e confirmar que está ativa.
- [ ] Informar se uma única natureza atende a todos os cenários ou se serão necessárias regras/naturezas distintas.
- [ ] Definir os CFOPs aplicáveis à fabricação própria e à eventual revenda. **CFOP** identifica o tipo de operação fiscal.
- [ ] Definir CSOSN/CST e o tratamento dos tributos aplicáveis. Esses códigos indicam a situação tributária da operação.
- [ ] Validar vendas dentro do estado e para outros estados; consumidor final e contribuinte; pessoa física e jurídica, quando atendidas pela loja.
- [ ] Confirmar a aplicação ou não de ICMS, substituição tributária, DIFAL, FCP, IPI, PIS e COFINS, conforme cada cenário.
- [ ] Informar exigências atuais de IBS/CBS e regras de transição que se apliquem à empresa, ao produto e à data de entrada em operação.
- [ ] Informar benefícios fiscais, exceções, observações legais e informações complementares obrigatórias, se houver.
- [ ] Validar como frete e descontos entram no cálculo e na nota, incluindo cupons e eventual frete subsidiado.

### 3. Dados fiscais de cada produto

Entregar uma planilha com uma linha por produto/variação quando os dados forem diferentes. Não presumir que todos os chinelos e sandálias têm a mesma classificação.

| Informação | O que a contabilidade deve confirmar |
| --- | --- |
| Código/SKU e descrição | Qual item da loja e do Bling recebe a configuração |
| Fabricação ou revenda | Como o item é obtido e vendido |
| NCM | Classificação fiscal da mercadoria |
| CEST | Código de substituição tributária, quando aplicável |
| Origem da mercadoria | Código de origem adequado ao produto |
| Unidade comercial e tributável | Unidade e eventual conversão usadas na nota |
| GTIN/EAN | Código de barras ou tratamento aplicável quando não existir |
| Tributos e exceções | Regras, alíquotas e enquadramentos aprovados por cenário |

### 4. Devolução, cancelamento e expedição

- [ ] Definir o procedimento e a natureza fiscal para devoluções/trocas, inclusive devolução parcial.
- [ ] Informar como tratar cancelamento, carta de correção, inutilização e rejeição de NF-e, quando aplicáveis, com responsáveis e prazos.
- [ ] Explicar quando a nota pode ser emitida após o pagamento e qual documento fiscal precisa estar autorizado antes da expedição.
- [ ] Definir o que fazer quando o pagamento é aprovado, mas a nota é rejeitada ou a SEFAZ fica indisponível; a expedição deve respeitar o bloqueio fiscal.
- [ ] Definir armazenamento e acesso a XML/DANFE, envio ao cliente e disponibilização à contabilidade.
- [ ] Informar responsável por dúvidas/rejeições e canal de atendimento durante a operação.

### 5. Evidência de aprovação

Pedir uma resposta escrita com:

- Nome do responsável contábil, data e identificação profissional pertinente.
- Regime e fabricação própria/revenda confirmados.
- Nome das naturezas aprovadas e planilha fiscal dos produtos.
- Cenários de venda validados e eventuais restrições.
- Confirmação das configurações e das validações de emissão em ambiente apropriado, sem emissão real não autorizada.
- Pendências restantes, responsável por cada uma e autorização expressa para a etapa de ativação fiscal quando tudo estiver regular.

## O que a equipe técnica fará com essa resposta

Conferir as configurações no Bling, localizar o ID da natureza aprovada, vincular os produtos pelo código, testar o fluxo permitido e registrar a evidência. Permanecem desligados `BLING_FISCAL_READY` e `BLING_INVOICE_SEND_ENABLED` até a aprovação documentada e a autorização de ativação.

**Código/SKU** é a identificação única de um item, por exemplo, um modelo em determinada cor e tamanho. A empresa também precisa conferir o saldo físico de cada item antes de ativar a sincronização real do estoque. Essa contagem é uma responsabilidade operacional, não uma decisão tributária do contador.

## Referências oficiais

- [Bling: preparação para emitir NF-e](https://ajuda.bling.com.br/hc/pt-br/articles/10448080778007-Dia-1-Deixe-tudo-pronto-para-emitir-a-nota-NF-e)
- [Bling: treinamento do módulo fiscal](https://ajuda.bling.com.br/hc/pt-br/articles/31642691873303-Treinamento-sobre-o-M%C3%B3dulo-Fiscal-do-Bling)

Guarde a resposta preenchida e documentos empresariais no canal privado da empresa. Este arquivo do repositório contém somente a solicitação, sem dados pessoais, credenciais ou certificado digital.
