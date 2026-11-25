# Emissão de atacado — análise da NF-e autorizada manualmente em 24/11/2026

## Evidência fiscal recebida

O DANFE e o XML disponibilizados pela contabilidade mostram número 3, série 2, ambiente 1, protocolo de autorização cStat 100, 36 pares, R$ 612,00, CFOP 5102, CSOSN 102, NCM 64022000, origem 0, PIS e COFINS 49, unidade PR, indFinal 0, indIEDest 1, indPres 2, modFrete 3. O XML não tem grupo retirada, não identifica transportador e informa tPag 90/vPag 0. A natureza ainda tem “Homologacao” no nome, mas tpAmb=1. Não confundir número sequencial 3 com série 003.

## Divergências e ações

- A regra MG02 aprovada no banco exige série 3, natureza ID 15111725693; a série real da emissão manual é 2. O Bling vincula a série à natureza: https://ajuda.bling.com.br/hc/pt-br/articles/360036464953-Como-alterar-o-n%C3%BAmero-de-s%C3%A9rie-das-notas-fiscais . A API de listagem não documenta série; não alterar série/número arbitrariamente. Confirmar natureza de venda ativa, série e natureza de devolução separadas antes de ampliar o fluxo.
- O XML usa códigos curtos por cor/tamanho, enquanto os vínculos do catálogo interno usam SKU importado. Não substituir códigos globalmente, nem presumir alias por semelhança textual. Validar os vínculos por variante/ID de produto e preservar documento autorizado.
- Transporte próprio pode constar sem dados do transportador no XML recebido. Conferir modalidade 3 sem exigir cadastro de transportadora fictício. Não eliminar a validação de endereço real de retirada.
- O XML manual diverge da forma de pagamento Pix registrada no painel e não contém retirada de Nova Serrana. Não reproduzir esses desvios sem aprovação contábil.
- Regime do comprador (normal, Simples, MEI ou PF) é distinto do CRT do emitente (1). MG02 sem crédito permanece o cenário aprovado. Não liberar CSOSN 101 com crédito zero, nem inferir alíquota, IE ou direito a crédito. Normal, MEI e PF exigem regras/documentos específicos; PF consumidor final usa fluxo de varejo quando elegível, não revenda automaticamente.
- Devolução de venda: natureza de entrada específica, referência à chave original, regra de CFOP, série e tratamento tributário aprovados. Não reutilizar a natureza de venda.
- Cancelamentos concluídos podem sair da lista por arquivamento, preservando histórico e estoque. Uma nota emitida manualmente deve ficar protegida de nova emissão/cancelamento até conciliação fiscal.

## Aceite pendente

Conferir a configuração da natureza de operação no Bling, validar código/ID fiscal dos produtos e os dados reais de retirada e pagamento. Em ambiente apropriado, provar o caminho completo via API até XML autorizado, sem reemitir notas reais. Não considerar CI verde como homologação fiscal. Não armazenar XML/DANFE real no Git.

O painel passou a exigir declaração explícita do regime, com validação também na API e no banco. A declaração do operador não substitui a consulta fiscal oficial. MG01, MG03 e MG04 continuam condicionados a homologação específica; o crédito candidato de novembro de 1,36% não se aplica automaticamente a todo comprador normal.
