# Segurança

Controles principais: RLS default-deny, CSP, validação Zod, allowlist de origem, URLs internas seguras, upload privado, idempotência, estoque bloqueado por linha, webhook assinado e consulta posterior ao provider.

Logs removem senhas, tokens, cookies, CPF e dados financeiros. Ações críticas recebem `request_id`. Nunca confie em preço, desconto, status ou permissão enviados pelo navegador.

Checklist pré-produção: executar testes RLS, secret scan, auditoria de dependências, validar buckets, habilitar MFA, configurar Turnstile/WAF, testar restauração e revisar retenção LGPD.

## Representantes e criativos

O usuário pode acumular os papéis de cliente e representante. Permissões internas são verificadas no
banco; esconder controles na interface não concede nem revoga acesso. Documentos de candidatura,
contratos e criativos permanecem em buckets privados e são entregues por URL assinada curta.

CPF é criptografado no servidor e a interface usa apenas os quatro últimos dígitos. Aplicações,
hierarquia, comissões, kits e criativos possuem RLS por propriedade ou permissão interna. Aprovações,
mudanças de status, fechamentos e downloads relevantes geram trilha auditável. O grafo de indicação
rejeita ciclos e lançamentos financeiros usam chaves de idempotência.

MFA e Turnstile podem ficar temporariamente desativados por configuração explícita, mas seu estado
deve ser exibido como não configurado. Habilitar as flags torna as respectivas credenciais e
verificações obrigatórias.

## Políticas, consentimentos e direitos dos titulares

Documentos jurídicos começam como minutas privadas. Edição administrativa, revisão jurídica e
publicação gerencial usam permissões diferentes. A publicação exige responsável, revisor, aprovação,
vigência e dados empresariais conferidos; cada publicação gera snapshot imutável com hash. A visão
pública remove identificadores internos e apresenta apenas versões vigentes.

Aceites ficam ligados à versão imutável e ao contexto. Preferências de cookies registram apenas um
identificador aleatório, versão, categorias, origem e revogação; cookies opcionais partem desligados.
Solicitações de titulares recebem protocolo e exigem verificação de identidade antes de resposta ou
qualquer providência sobre dados. Exclusões nunca são automáticas quando houver retenção aplicável.

## Central de Ajuda e atendimento

Rascunhos da ajuda são separados do snapshot público imutável. Criação, revisão e publicação usam
permissões distintas; o autor não aprova o próprio conteúdo. Busca pública consulta apenas versões
publicadas ou agendadas já vigentes e registra termos sem resultado após remover padrões de e-mail e
números longos.

Chamados continuam protegidos por propriedade ou atribuição explícita. Anexos ficam no bucket
privado, aceitam somente JPG, PNG, WebP e PDF de até 10 MB e têm assinatura binária conferida no
servidor. A URL assinada curta só é emitida depois que `scan_status` estiver como `clean`; arquivos
pendentes não são entregues. Mensagens e abertura de chamados possuem limite de frequência no banco.

## Construtor da página inicial

O construtor separa o rascunho editável do manifesto público imutável. Criação, edição, revisão,
publicação, mídia, métricas e auditoria usam permissões independentes e são verificadas no servidor;
o autor não pode aprovar a própria versão. A loja consulta somente `published_homepage_sections`, que
remove nomes internos e seleciona uma publicação inteira em uma única versão.

Configurações rejeitam HTML, JavaScript, handlers e URLs perigososas. Produtos, categorias, modelos,
coleções e arquivos são reconferidos no banco na gravação e antes da publicação. Mídias comerciais
aceitam somente JPG, PNG, WebP, MP4 e WebM com assinatura binária validada, limites de tamanho e
pastas controladas. Métricas guardam somente contagens agregadas por versão, item, dia e dispositivo.
