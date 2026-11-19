# Pendências para liberar kits para revenda

**Estado: BLOQUEADO_EM_PRODUCAO.** A compra permanece indisponível até que todos os critérios aplicáveis sejam comprovados.

1. Responsável fiscal: confirmar dados do emitente, produtos, classificação dos destinatários e aprovar matriz por cenário e vigência; nenhum código histórico deve ser aplicado por presunção.
2. Engenharia: concluir integração própria dos pedidos de kits com pagamento, conciliação, Bling e expedição, preservando a independência do checkout ao consumidor final.
3. Operação e engenharia: comprovar a representação do kit e a movimentação de estoque físico/virtual sem dupla baixa, inclusive cancelamentos e devoluções.
4. Engenharia e responsáveis pelas integrações: demonstrar isolamento dos ambientes de pagamento, frete, banco e NF-e antes de executar a homologação completa.
5. Engenharia e responsáveis comercial/fiscal: verificar regras aprovadas, autorização de acesso, RLS, eventos duplicados, concorrência, reconciliação, monitoramento, rollback e liberação controlada por cenário.

O armazenamento privado de versões, aprovações e revogações está preparado em migration, sem regras cadastradas. A consulta é restrita ao servidor, recusa versões ausentes, expiradas ou ambíguas e não autoriza compra, cobrança, emissão ou expedição. A integração ainda precisa validar parâmetros, identidade, evidências e os demais bloqueios antes de usar um candidato. A migration não foi aplicada em produção.

Rollback: antes de qualquer implantação, registrar backup e responsáveis. Se necessário, manter as operações de kits bloqueadas e desativar o uso da consulta; não apagar versões, aprovações ou revogações, que constituem histórico. Alterações ou remoções de esquema exigem migration e revisão próprias, nunca edição de migration aplicada.

Uma integração autenticada ou uma nota de homologação manual não satisfazem esses critérios. Não alterar configurações globais de emissão nem ativar compras enquanto houver pendências.
