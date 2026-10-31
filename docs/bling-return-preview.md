# Prévia de devolução pelo XML original

O endpoint técnico `POST /api/integrations/bling/fiscal-preview` aceita
`{"returnId":"UUID da devolução registrada"}`. Autenticação técnica, perfil ativo,
permissão de integrações e verificação de origem são obrigatórios. O cliente não
fornece XML, chave, preço, quantidade ou rateio. A resposta é privada e sem cache.

O servidor carrega a devolução e os itens originais por uma RPC exclusiva de
`service_role`. A nota vinculada precisa estar autorizada e possuir XML no bucket
privado `fiscal-documents`. O caminho determinístico e SHA-256 são conferidos
antes do processamento. Não são aceitos uploads nem URLs fornecidas pelo cliente.

O parser lê NF-e 4.00 processada, protocolo autorizado e chave/ambiente coerentes.
O escopo suportado é saída normal para consumidor final pessoa física não
contribuinte, com pares inteiros em PR e valores representáveis em centavos.
Namespaces, duplicidades, tamanho, profundidade e nós são limitados; DTDs,
entidades externas, XML malformado e rateios incompatíveis são bloqueados.
A origem do arquivo é o arquivo privado obtido do provedor; o parser não realiza
verificação criptográfica independente da assinatura XML.

Preços, desconto, frete e acréscimos vêm das linhas e totais arquivados. O vínculo
com o pedido usa o SKU original ou a referência comercial gravada no XML dos
componentes do kit. Mudanças atuais no catálogo não alteram a devolução. Casos
sem vínculo unívoco, seguro não suportado ou fração de centavo exigem revisão.

O saldo inclui todas as outras solicitações registradas, inclusive concluídas.
Somente rejeitadas/canceladas deixam de reservar quantidade. Triggers serializam
alterações por devolução e item original; reativar uma solicitação não permite
ultrapassar a quantidade vendida. As migrations não reescrevem registros antigos;
um histórico inconsistente bloqueia a prévia.

O saldo retornado é uma observação das solicitações do sistema. Esta prévia
continua `transmittable:false`, não reserva emissão, não consome número fiscal,
não transmite, não reembolsa e não movimenta estoque. Devoluções emitidas fora
do sistema precisam ser conciliadas antes de uma futura integração de emissão.
Ausência de contexto/documento válido retorna 409; falha de serviço retorna 503.

Validações sintéticas ficam nos testes de `bling-return-xml`,
`bling-return-context`, `bling-return-preview` e
`supabase/tests/bling_return_archive_context_test.sql`. Não usar essas fixtures
como documento autorizado real ou inseri-las no banco original.
