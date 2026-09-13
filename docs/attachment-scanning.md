# Varredura de anexos de atendimento

O fluxo atual é **fail-closed**: uploads novos recebem `scan_status=pending` e permanecem no bucket
privado. A API de atendimento só cria URL assinada quando o registro está `clean`; `pending`,
`infected`, `failed` ou qualquer valor desconhecido nunca disponibiliza o arquivo.

## Pendência externa

O repositório ainda não contém nem configura um mecanismo antimalware. Para ativar anexos em
produção é necessário contratar/configurar um scanner real capaz de ler objetos do bucket
`customer-private`, verificar o conteúdo e atualizar o metadado por um backend server-only. Não
marque arquivos como limpos por extensão, MIME, assinatura inicial ou sucesso do upload: essas
checagens já bloqueiam formatos inválidos, mas não substituem varredura antimalware.

Checklist de integração:

1. Consumir somente registros `pending`, em lote limitado, com idempotência e tentativas limitadas.
2. Baixar o objeto por credencial server-only sem gerar URL pública.
3. Marcar `clean` somente após resultado conclusivo do scanner; marcar `infected` ou `failed` nos
   demais resultados e registrar código técnico sem conteúdo do arquivo ou credenciais.
4. Restringir a atualização de `scan_status` ao papel técnico/backend; clientes e operadores não
   podem aprovar o próprio anexo.
5. Testar arquivo limpo, arquivo de teste EICAR, timeout, objeto ausente e repetição do mesmo evento.
6. Só então habilitar a experiência comercial que dependa do download desses anexos.

Até essa integração existir e ser testada, anexos pendentes continuarão visíveis apenas como
“aguardando verificação”, sem link de download.
