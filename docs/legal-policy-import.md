# Importação e publicação de políticas

Aplicar `supabase/migrations/202610030001_legal_policy_import_publication.sql` antes de disponibilizar a nova interface. A migration conserva documentos, versões, aceites e permissões existentes. Não publica os anexos. Administradores continuam preparando minutas; publicar exige `legal_content.publish` (gerência ou autorização já cadastrada).

1. Em `/administracao/politicas` ou `/gerencia/politicas`, selecionar ou arrastar DOCX, TXT, HTML, Markdown, ZIP e, opcionalmente, `Mapa_de_Publicacao.json`. Os destinos são os oito slugs existentes; guia e manifesto não viram páginas.
2. Conferir reconhecimento e conteúdo. Escolher apenas destinos ambíguos ou versões conflitantes. Em **Editar**, preencher pendências; os dados empresariais são cadastrados uma vez e aplicados após conferir a prévia. Não inserir condições comerciais não confirmadas.
3. Usar **Publicar políticas prontas** ou **Publicar** por política e conferir **Ver no site**. Cada resultado de lote é informado separadamente. Repetir uma publicação concluída não cria outra versão. Uma nova minuta mantém a versão pública anterior.

A publicação direta registra aprovação do responsável sobre o hash da versão; não representa revisão jurídica. A ferramenta de revisão jurídica e os registros anteriores permanecem na área avançada. Mudanças no texto, metadados, referências ou dados empresariais invalidam aprovações de minutas. Datas de preparação presentes no documento são preservadas; publicação e vigência são registradas pelo banco na data real.

Parsers executam no navegador, carregados na seleção de arquivos, sem conversores externos. DOCX aceita texto do corpo, títulos, destaques, listas e links; cabeçalhos/rodapés de impressão não são importados. Objetos incorporados e documentos ilegíveis são rejeitados. HTML vira texto estruturado; scripts, estilos e conteúdo ativo são descartados e nunca inseridos no DOM da aplicação. Arquivos com imagens ou conteúdo sem texto legível não substituem uma política. Não há OCR. Aceites, categorias e preferências de cookies não são criados ou modificados pela importação.

Limites: 40 documentos, 8 MB por arquivo, 24 MB por seleção, 100 entradas por ZIP, 4 MB por entrada e 40 MB descompactados. Caminhos perigosos, ZIP dividido, ZIP64, criptografia, duplicação de caminhos e expansão excessiva são rejeitados. Até 80 seções, 30 mil caracteres por seção e payload de 300 mil bytes. Um manifesto orienta somente os destinos; referências bibliográficas e instruções de vigência continuam no documento completo.

As páginas `/politicas` e `/politicas/[slug]` consultam versões vigentes a cada requisição, sem exigir novo deploy para atualização de conteúdo. Documentos antigos continuam como texto simples. Outros documentos permanecem na área avançada.

## Validação reproduzível

Testes unitários e da API: `pnpm exec vitest run packages/domain/src/legal-policies.test.ts apps/panel/src/lib/legal-import.test.ts apps/panel/src/lib/legal-api.test.ts apps/panel/src/app/api/legal/policies/route.test.ts apps/store/src/components/legal-content.test.tsx apps/store/src/lib/legal-data.test.ts --maxWorkers=1 --fileParallelism=false`.

Navegador: `pnpm exec playwright test --config playwright.legal.config.ts`. Executa um servidor de painel e um worker. Os testes de tela usam respostas de API isoladas e identificadas como fixtures; não gravam dados comerciais. Testes de origem e recusa de sessão usam a API real. Definir `LEGAL_DOCUMENT_FIXTURES` para o diretório dos nove DOCX anexados habilita a extração real e a comparação integral com o XML original, os oito destinos, destaque, deduplicação dos três formatos e um ZIP gerado com os documentos, variantes e manifesto. As variantes geradas servem como fixtures de teste; não foram fornecidas como anexos originais.

Banco: `supabase/tests/legal_policy_import_publication_test.sql`, executar com `pnpm exec supabase test db` em banco local isolado. Esses testes usam transação com rollback. Sem Docker/banco isolado, não se pode afirmar validação real de RLS, transações, versões ou concorrência. Nenhuma migration deve ser aplicada automaticamente em produção para executar testes.

Typecheck dos testes deste recurso: `pnpm exec tsc -p tests/e2e/tsconfig.legal.json --noEmit`. O typecheck conjunto dos E2E encontrou um erro preexistente em `responsive.spec.ts:113` (valor possivelmente indefinido em `toHaveAttribute`), fora deste fluxo. Esse arquivo foi preservado.
