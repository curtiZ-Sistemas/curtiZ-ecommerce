# Anexos em quarentena

Uploads são privados, limitados e associados a uma mensagem autorizada. Imagens passam pelo decoder do binding `IMAGES` e são reencodadas. O SHA-256 dos bytes armazenados acompanha o anexo. O estado inicial é sempre `pending`; RLS do Storage e a API só liberam download em `clean`.

## Única integração externa restante

Conecte um executor confiável a um scanner real, implementando `AttachmentScanner` de `@curtiz/security`. Nenhum fornecedor ou resultado simulado está habilitado. Enquanto isso, arquivos permanecem em quarentena e não podem ser baixados.

O executor deve:

1. Usar credencial server-only com acesso restrito; chamar `claim_support_attachment_scan` para obter um job e seu token de lease.
2. Baixar do bucket privado `customer-private` o caminho do job, com limite efetivo de 10 MB. Não aceitar URL do cliente nem publicar URL assinada.
3. Confirmar o SHA-256 esperado e chamar `scanAttachment` com um scanner real. A interface aplica timeout e nunca converte ausência, erro ou verdict desconhecido em `clean`.
4. Chamar `finish_support_attachment_scan` com job, token, SHA-256 e verdict. Somente o lease vigente e o objeto esperado podem finalizar a análise.
5. Registrar somente IDs, resultado e duração. Não registrar bytes, nomes originais, URLs privadas, tokens ou dados da mensagem.

Jobs abandonados podem ser retomados após cinco minutos, até cinco tentativas. Jobs falhos permanecem bloqueados e exigem investigação/reagendamento confiável. Anexos pendentes anteriores à migration não têm checksum: um operador confiável deve calcular o hash dos bytes privados antes de permitir sua análise; não atribua `clean` manualmente para liberar a fila.
