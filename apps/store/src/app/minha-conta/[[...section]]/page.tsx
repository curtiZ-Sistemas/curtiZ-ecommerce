import { formatBRL } from "@curtiz/domain";
import { Heart, MapPin, MessageCircle, PackageCheck, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Minha conta", robots: { index: false, follow: false } };

const nav = [
  ["Resumo", "/minha-conta"],
  ["Pedidos", "/minha-conta/pedidos"],
  ["Endereços", "/minha-conta/enderecos"],
  ["Favoritos", "/minha-conta/favoritos"],
  ["Segurança", "/minha-conta/seguranca"],
  ["Trocas", "/minha-conta/trocas"],
  ["Atendimento", "/minha-conta/atendimento"],
  ["Privacidade", "/minha-conta/privacidade"]
] as const;

export default async function AccountPage({
  params
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.[0] ?? "resumo";
  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Área do cliente</p>
          <h1>Olá, cliente demo</h1>
          <p>Dados fictícios para validar os fluxos locais.</p>
        </div>
      </div>
      <div className="account-layout">
        <nav className="account-nav" aria-label="Minha conta">
          {nav.map(([label, href]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <section>
          {section === "resumo" && <AccountSummary />}
          {section === "pedidos" && <Orders />}
          {section === "enderecos" && <Addresses />}
          {section === "favoritos" && <Empty title="Nenhum favorito salvo" icon={<Heart />} />}
          {section === "seguranca" && <Security />}
          {section === "trocas" && <Empty title="Nenhuma troca em andamento" icon={<RotateCcw />} />}
          {section === "atendimento" && <Support />}
          {section === "privacidade" && <Privacy />}
        </section>
      </div>
    </div>
  );
}

function AccountSummary() {
  return (
    <>
      <div className="account-grid">
        <div className="account-card">
          <PackageCheck />
          <span>Total de pedidos</span>
          <strong>3</strong>
        </div>
        <div className="account-card">
          <PackageCheck />
          <span>Em andamento</span>
          <strong>1</strong>
        </div>
        <div className="account-card">
          <Heart />
          <span>Favoritos</span>
          <strong>0</strong>
        </div>
      </div>
      <div className="form-card" style={{ marginTop: 18 }}>
        <h2>Pedido em andamento</h2>
        <p>
          <strong>#CZT-DEMO01</strong> • {formatBRL(13480)}
        </p>
        <span className="status-pill">Pagamento aprovado</span>
      </div>
    </>
  );
}

function Orders() {
  return (
    <div className="form-card">
      <h2>Meus pedidos</h2>
      {[
        ["#CZT-DEMO01", "Pagamento aprovado", 13480],
        ["#CZT-DEMO02", "Entregue", 7990],
        ["#CZT-DEMO03", "Cancelado", 5990]
      ].map(([code, status, total]) => (
        <div className="summary-line" key={String(code)}>
          <span>
            <strong>{code}</strong>
            <br />
            {status}
          </span>
          <strong>{formatBRL(Number(total))}</strong>
        </div>
      ))}
    </div>
  );
}

function Addresses() {
  return (
    <div className="form-card">
      <MapPin />
      <h2>Endereços</h2>
      <p>Nenhum endereço salvo. O endereço só é solicitado quando necessário para uma compra.</p>
      <button className="secondary-button">Adicionar endereço</button>
    </div>
  );
}

function Security() {
  return (
    <div className="form-stack">
      <div className="form-card">
        <ShieldCheck />
        <h2>Segurança da conta</h2>
        <p>Altere sua senha, revise sessões e ative MFA opcional.</p>
        <button className="secondary-button">Revisar sessões</button>
      </div>
      <div className="form-card">
        <h2>Últimos acessos</h2>
        <p>Os dados serão carregados do Supabase Auth após a conexão local.</p>
      </div>
    </div>
  );
}

function Support() {
  return (
    <div className="form-card">
      <MessageCircle />
      <h2>Meus atendimentos</h2>
      <p>Acompanhe respostas, status e histórico completo.</p>
      <Link className="primary-button" href="/ajuda">
        Abrir atendimento
      </Link>
    </div>
  );
}

function Privacy() {
  return (
    <div className="form-stack">
      <div className="form-card">
        <h2>Preferências e LGPD</h2>
        <p>Gerencie consentimentos ou solicite exportação, anonimização e exclusão.</p>
      </div>
      <button className="secondary-button">Solicitar meus dados</button>
    </div>
  );
}

function Empty({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>Quando houver informações, elas aparecerão aqui.</p>
    </div>
  );
}
