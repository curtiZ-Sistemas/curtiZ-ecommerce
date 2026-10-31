"use client";

import { useState, type FormEvent } from "react";

export function ReturnReviewActions({ id, status, resolution, kind, canReview, canInspect, canRefund, needsReconciliation, busy, run }: {
  id: string; status: string; resolution: string; kind: string; canReview: boolean; canInspect: boolean; canRefund: boolean; busy: boolean;
  needsReconciliation: boolean;
  run: (body: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const actions: Array<[string, string]> = [];
  if (canReview && ["requested", "in_review", "waiting_photos"].includes(status)) {
    actions.push(["review", "Registrar análise"], ["approve", "Autorizar devolução"]);
    if (kind !== "withdrawal") actions.push(["photos", "Pedir informações ou fotos"], ["reject", "Não aprovar, com justificativa"]);
  }
  if (canReview && ["approved", "waiting_posting"].includes(status)) actions.push(["posting", "Fornecer autorização e instruções de postagem"]);
  if (canInspect && status === "waiting_posting") actions.push(["transit", "Registrar postagem e rastreio"]);
  if (canInspect && ["approved", "waiting_posting", "in_transit"].includes(status)) actions.push(["receive", "Confirmar recebimento físico"]);
  if (canReview && status === "inspection" && resolution === "exchange") actions.push(["exchange", "Confirmar envio da troca e informar rastreio"]);
  if (canReview && status === "exchange_sent") actions.push(["complete", "Concluir troca"]);
  if (canRefund && resolution === "refund" && ["approved", "waiting_posting", "in_transit", "received", "inspection"].includes(status)) actions.push(["refund", "Solicitar reembolso ao provedor"]);
  if (canRefund && status === "refund_requested" && needsReconciliation) actions.push(["reconcile", "Conferir estorno existente no provedor"]);
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const action = actions.some(([key]) => key === selected) ? selected : actions[0]?.[0] ?? "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (await run({ action: "review_return", returnId: id, decision: action, message: data.get("message"),
      instructions: data.get("instructions") ?? "", code: data.get("code") ?? "" },
    action === "refund" ? "Reembolso solicitado. Aguarde a confirmação do provedor." : "Etapa registrada e disponibilizada ao cliente.")) setOpen(false);
  };
  if (!actions.length) return null;
  return <div className="return-review-actions">
    <button className="secondary-button" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Fechar avaliação" : "Avaliar e atualizar solicitação"}</button>
    {open && <form className="operational-form" onSubmit={event => void submit(event)}>
      <label className="operational-field"><span>Próxima etapa</span><select value={action} onChange={event => setSelected(event.target.value)}>{actions.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      <label className="operational-field"><span>Resposta ao cliente</span><textarea name="message" required minLength={5} maxLength={2000} rows={3} placeholder="Explique a decisão e os próximos passos." /></label>
      {["posting", "transit", "exchange", "reconcile"].includes(action) && <label className="operational-field"><span>{action === "posting" ? "Autorização de postagem fornecida pela loja" : action === "reconcile" ? "Identificador do estorno já registrado no provedor" : "Código de rastreamento"}</span><input name="code" minLength={action === "reconcile" ? 1 : 3} maxLength={120} required /></label>}
      {action === "reconcile" && <p>Informe o identificador de um estorno já existente. O sistema consultará o pagamento e conferirá valor e confirmação. Esta ação não solicita outro reembolso.</p>}
      {action === "posting" && <><label className="operational-field"><span>Onde e como postar, validade e orientações de embalagem</span><textarea name="instructions" rows={4} minLength={10} maxLength={2000} required /></label><p>Emita a autorização no serviço logístico contratado e informe os dados acima. Nos casos de arrependimento e defeito coberto, a loja assume o custo; não oriente o cliente a pagar o retorno.</p></>}
      {action === "refund" && <p>Ao confirmar, você autoriza uma solicitação financeira ao provedor. O servidor calcula a parcela dos valores pagos, incluindo o frete proporcional. A confirmação do reembolso aparecerá após a resposta do provedor. Para arrependimento, não atrase o estorno aguardando uma avaliação de preferência.</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Salvando…" : action === "refund" ? "Confirmar solicitação de reembolso" : "Salvar etapa"}</button>
    </form>}
  </div>;
}
