import { CircleX, Clock3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Pedido pendente", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  const supabase = pedido ? await createServerSupabaseClient() : null;
  const { data: order } = supabase
    ? await supabase.from("orders").select("payment_status").eq("public_code", pedido).maybeSingle()
    : { data: null };
  const status = String(order?.payment_status ?? "pending");
  const approved = status === "approved";
  const failed = status === "rejected" || status === "cancelled";
  return (
    <div className="container page-shell account-experience-page">
      <div className="empty-state">
        {approved ? <ShieldCheck size={48} /> : failed ? <CircleX size={48} /> : <Clock3 size={48} />}
        <p className="eyebrow">Pedido {pedido ?? "em processamento"}</p>
        <h1>{approved ? "Pagamento aprovado" : failed ? "Pagamento não aprovado" : "Aguardando confirmação do pagamento"}</h1>
        <p>{approved
          ? "O pagamento foi confirmado pelo servidor e o pedido seguirá para preparação."
          : failed
            ? "Nenhuma cobrança foi concluída. Você pode revisar o carrinho e tentar novamente."
            : "O pedido não será marcado como pago sem confirmação do servidor."}</p>
        <Link className="primary-button" href="/minha-conta/pedidos">
          Acompanhar pedidos
        </Link>
      </div>
    </div>
  );
}
