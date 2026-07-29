import { Clock3 } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Pedido pendente", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  return (
    <div className="container page-shell">
      <div className="empty-state">
        <Clock3 size={48} />
        <p className="eyebrow">Pedido {pedido ?? "em processamento"}</p>
        <h1>Aguardando confirmação do pagamento</h1>
        <p>
          Este ambiente usa um provedor mock. Nenhum valor foi cobrado e o pedido não será marcado
          como pago sem confirmação do servidor.
        </p>
        <Link className="primary-button" href="/minha-conta/pedidos">
          Acompanhar pedidos
        </Link>
      </div>
    </div>
  );
}
