# Parâmetros tributários nos espelhos

As regras privadas incluem CSTs e os campos `pis_rate`, `cofins_rate`, `ipi_rate` e `ipi_cenq`. Alíquota zero exige confirmação explícita; campo ausente bloqueia aprovação automática. Alterar um parâmetro invalida o hash do espelho e da política de automação.

A migration incremental apenas adiciona colunas opcionais, sem valores fiscais, políticas ou ativações. O código é compatível com o schema anterior: parâmetros ausentes mantêm o fluxo fiscal bloqueado. O deploy do código não aplica a migration remota, que segue o requisito de backup verificado em [deployment](deployment.md).

Os fragmentos XML de PIS, COFINS e IPI recebem bases explícitas em centavos. Uma alíquota zero não implica base zero. O fragmento não é uma NF-e completa, não consome numeração, não transmite e não substitui validação do XML integral calculado pelo Bling, incluindo frete, desconto e despesas.

Códigos de saída não devem ser copiados automaticamente para uma devolução de entrada. A conferência deve considerar a operação e o documento original, sem alterar a classificação aprovada das vendas.
