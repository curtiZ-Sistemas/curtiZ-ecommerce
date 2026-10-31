"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatBRL, returnKindLabels, returnPolicySummary, returnStatusLabels, validateReturnPhotos, type ReturnKind } from "@curtiz/domain";
import type { CustomerOrder, CustomerReturn } from "@/lib/customer-account-types";

const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
type Props = { returns: CustomerReturn[]; orders: CustomerOrder[]; pending: boolean;
  runAction: (body: Record<string, unknown>, success: string, files?: FileList | null) => Promise<unknown> };

function Photos({ record }: { record: CustomerReturn }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const photos = record.media ?? [];
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const files = new FormData(form).getAll("photos").filter((file): file is File => file instanceof File && file.size > 0);
    const invalid = validateReturnPhotos(files, photos.length);
    setError(invalid);
    setNotice("");
    if (invalid || !files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        const body = new FormData(); body.set("returnId", record.id); body.set("file", file);
        const result = await fetch("/api/customer/return-media", { method: "POST", body, signal: AbortSignal.timeout(60_000) });
        if (!result.ok) {
          const data = await result.json().catch(() => ({})) as { message?: string };
          throw new Error(data.message ?? "Não foi possível enviar a foto. Confira as fotos já salvas antes de tentar novamente.");
        }
      }
      form.reset(); setNotice("Fotos enviadas para análise.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao enviar as fotos."); }
    finally { setBusy(false); router.refresh(); }
  };
  return <div className="customer-return-photos">
    {photos.length > 0 && <div className="return-photo-grid">{photos.map((photo, index) => <a href={`/api/customer/return-media?id=${photo.id}`} target="_blank" rel="noopener noreferrer" key={photo.id} aria-label={`Abrir foto ${index + 1} da solicitação ${record.publicCode}`}><img src={`/api/customer/return-media?id=${photo.id}`} alt={`Foto ${index + 1} do produto`} width={96} height={96} loading="lazy" /></a>)}</div>}
    {["requested", "in_review", "waiting_photos"].includes(record.status) && photos.length < 3 && <form onSubmit={event => void upload(event)} className="customer-form">
      <label className="customer-field"><span>Adicionar fotos ({photos.length}/3)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required disabled={busy} /><small>JPG, PNG ou WebP, até 5 MB cada. Fotos são opcionais para arrependimento.</small></label>
      <button className="secondary-button" type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar fotos"}</button>
    </form>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}

export function CustomerReturns({ returns, orders, runAction, pending }: Props) {
  const items = orders.filter(order => ["delivered", "return_requested", "returned"].includes(order.status))
    .flatMap(order => order.items.map(item => ({ ...item, orderCode: order.publicCode,
      quantity: Math.max(0, item.quantity - returns.filter(record => !["rejected", "cancelled"].includes(record.status))
        .flatMap(record => record.items ?? []).filter(returned => returned.orderItemId === item.id).reduce((sum, returned) => sum + returned.quantity, 0)) })))
    .filter(item => item.quantity > 0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReturnKind>("preference");
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const selectedId = items.some(item => item.id === selected) ? selected : items[0]?.id ?? "";
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = form.elements.namedItem("photos") as HTMLInputElement | null;
    const invalid = validateReturnPhotos(Array.from(input?.files ?? []));
    setError(invalid);
    if (invalid) return;
    const result = await runAction({ action: "return_request", kind, orderItemId: data.get("orderItemId"), quantity: Number(data.get("quantity")),
      resolution: data.get("resolution"), reason: data.get("reason") ?? "", description: data.get("description") ?? "" },
    "Solicitação recebida. Acompanhe a análise e as orientações nesta página.", input?.files);
    if (result) setOpen(false);
  };
  return <div className="customer-section-stack">
    <div className="customer-section-title"><div><span className="eyebrow">Pós-venda</span><h2>Trocas e devoluções</h2><p>Acompanhe a análise, a postagem e a solução de cada solicitação.</p></div>
      {items.length > 0 && <button className="primary-button compact-button" type="button" onClick={() => setOpen(true)}>Nova solicitação</button>}</div>
    <details className="customer-panel"><summary>Prazos, reembolso e custo da devolução</summary><p>{returnPolicySummary}</p><p>As fotos ajudam a equipe, mas não são condição para exercer o arrependimento. O prazo é para comunicar sua decisão. Aguarde as instruções de postagem; quando a devolução decorrer de arrependimento ou de defeito coberto, você não paga pelo retorno.</p><p>O reembolso será acompanhado pelo meio de pagamento original. Crédito na loja depende da sua escolha e da confirmação da equipe.</p><Link href="/politicas/trocas-e-devolucoes">Consultar política completa</Link></details>
    {open && <form className="customer-panel customer-form" onSubmit={event => void submit(event)}>
      <h3>Solicitar troca ou devolução</h3>
      <div className="customer-form-grid">
        <label className="customer-field customer-field-full"><span>Produto entregue</span><select name="orderItemId" value={selectedId} onChange={event => setSelected(event.target.value)} required>{items.map(item => <option value={item.id} key={item.id}>#{item.orderCode} · {item.productName} · {item.color}/{item.size}</option>)}</select></label>
        <label className="customer-field customer-field-full"><span>Tipo de solicitação</span><select value={kind} onChange={event => setKind(event.target.value as ReturnKind)}>{Object.entries(returnKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="customer-field"><span>Quantidade</span><input name="quantity" type="number" min={1} max={items.find(item => item.id === selectedId)?.quantity ?? 1} defaultValue={1} required /></label>
        <label className="customer-field"><span>Solução desejada</span><select name="resolution" key={kind} defaultValue={kind === "withdrawal" ? "refund" : "exchange"}><option value="exchange">Troca</option><option value="refund">Reembolso</option><option value="store_credit">Crédito na loja, por minha escolha</option></select></label>
        <label className="customer-field customer-field-full"><span>Motivo (opcional)</span><input name="reason" maxLength={120} /></label>
        <label className="customer-field customer-field-full"><span>Informações para a equipe (opcional)</span><textarea name="description" rows={4} maxLength={2000} /></label>
        <label className="customer-field customer-field-full"><span>Fotos do produto (até 3, opcionais)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple /><small>JPG, PNG ou WebP, até 5 MB cada. Você também pode adicionar fotos após enviar a solicitação.</small></label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="customer-form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Enviando…" : "Enviar solicitação"}</button><button className="secondary-button" type="button" disabled={pending} onClick={() => setOpen(false)}>Cancelar</button></div>
    </form>}
    {returns.map(record => <article className="customer-panel customer-return-detail" key={record.id}>
      <header><div><h3>{record.publicCode}</h3><small>Pedido #{record.orderCode} · {date(record.requestedAt)}</small></div><span className="customer-status">{returnStatusLabels[record.status] ?? record.status}</span></header>
      <p><strong>{record.reason}</strong>{record.description && <><br />{record.description}</>}</p>
      <p>Solução solicitada: <strong>{record.resolution === "refund" ? "Reembolso" : record.resolution === "exchange" ? "Troca" : "Crédito na loja, por escolha do cliente"}</strong></p>
      {record.message && <p><strong>Resposta da equipe:</strong> {record.message}</p>}
      {record.instructions ? <div className="customer-return-guidance"><h4>Como devolver</h4><p style={{ whiteSpace: "pre-wrap" }}>{record.instructions}</p><p>Autorização de postagem: <strong>{record.postingCode}</strong></p><p>Embale o produto com cuidado, siga as orientações acima e guarde o comprovante. A etiqueta de retorno deve ser fornecida pela loja nos casos de devolução gratuita.</p></div> : !["rejected", "cancelled", "completed", "refunded"].includes(record.status) && <p>Aguarde as orientações da equipe antes de postar o produto.</p>}
      {record.trackingCode && <p>Rastreio da devolução: <strong>{record.trackingCode}</strong></p>}
      {record.exchangeTrackingCode && <p>Rastreio do produto de troca: <strong>{record.exchangeTrackingCode}</strong></p>}
      {Boolean(record.refundAmountInCents) && <p>Valor do reembolso: <strong>{formatBRL(record.refundAmountInCents ?? 0)}</strong></p>}
      {record.refundNeedsReview && <p role="status">A equipe está verificando o reembolso com o provedor. A devolução do valor ainda não foi confirmada.</p>}
      <Photos record={record} />
      {Boolean(record.history?.length) && <details><summary>Histórico da solicitação</summary><ol>{record.history?.map(event => <li key={event.id}><strong>{returnStatusLabels[event.status] ?? event.status}</strong> · {date(event.createdAt)}<p>{event.message}</p></li>)}</ol></details>}
    </article>)}
    {!returns.length && <div className="customer-panel"><h3>Nenhuma solicitação</h3><p>{items.length ? "Escolha Nova solicitação para iniciar uma troca ou devolução." : "Os produtos aparecerão aqui após a confirmação da entrega."}</p></div>}
  </div>;
}
