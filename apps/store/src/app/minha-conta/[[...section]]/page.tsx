import { formatBRL } from "@curtiz/domain";
import { DEMO_SESSION_COOKIE, demoDestination, verifyDemoSession } from "@curtiz/security";
import { Heart, MapPin, PackageCheck, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { FavoritesPanel } from "@/components/favorites-panel";
import { SupportCenter } from "@/components/support-center";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readRows, readString } from "@/lib/unknown-data";

export const metadata = { title: "Minha conta", robots: { index: false, follow: false } };

const nav = [
  ["Perfil", "/minha-conta"],
  ["Minha conta", "/minha-conta/conta"],
  ["Pedidos", "/minha-conta/pedidos"],
  ["Endereços", "/minha-conta/enderecos"],
  ["Favoritos", "/minha-conta/favoritos"],
  ["Segurança", "/minha-conta/seguranca"],
  ["Trocas", "/minha-conta/trocas"],
  ["Atendimento", "/minha-conta/atendimento"],
  ["Privacidade", "/minha-conta/privacidade"]
] as const;

export default async function AccountPage({
  params,
  searchParams
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ new?: string; cadastro?: string }>;
}) {
  const section = (await params).section?.[0] ?? "perfil";
  const query = await searchParams;
  const startNewSupport = query.new === "1";
  const signupComplete = query.cadastro === "sucesso";
  const returnPath = `/minha-conta${section === "perfil" ? "" : `/${section}`}${
    startNewSupport ? "?new=1" : ""
  }`;
  const cookieStore = await cookies();
  const session =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (process.env.DEMO_MODE === "true" && !session) {
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }
  if (session && !session.roles.includes("customer")) {
    redirect(
      new URL(
        demoDestination(session.role),
        process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001"
      ).toString()
    );
  }

  let customerName = session?.fullName ?? "cliente";
  let customerEmail = session?.email ?? "";
  let customerPhone = "";
  let accountStatus = "Ativa";
  if (process.env.DEMO_MODE !== "true") {
    const supabase = await createServerSupabaseClient();
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (!data.user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    const rolesResponse: unknown = await supabase!
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const roles = readRows(readQueryResult(rolesResponse).data).map((item) =>
      readString(item, "role")
    );
    const internalRole = roles.find(
      (role): role is "admin" | "manager" | "operational" | "technical" =>
        role === "admin" ||
        role === "manager" ||
        role === "operational" ||
        role === "technical"
    );
    if (internalRole && !roles.includes("customer")) {
      redirect(
        new URL(
          demoDestination(internalRole),
          process.env.NEXT_PUBLIC_PANEL_URL ?? "http://localhost:3001"
        ).toString()
      );
    }
    const metadataName: unknown = data.user.user_metadata.full_name;
    customerName = typeof metadataName === "string" ? metadataName : "cliente";
    customerEmail = data.user.email ?? "";
    const profileResponse = await supabase!
      .from("profiles")
      .select("full_name,email_snapshot,phone,status")
      .eq("id", data.user.id)
      .maybeSingle();
    const profile = readQueryResult(profileResponse).data;
    if (isUnknownRecord(profile)) {
      customerName = readString(profile, "full_name") || customerName;
      customerEmail = readString(profile, "email_snapshot") || customerEmail;
      customerPhone = readString(profile, "phone");
      accountStatus = readString(profile, "status") === "active" ? "Ativa" : "Em análise";
    }
  }
  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Área do cliente</p>
          <h1>Olá, {customerName}</h1>
          {process.env.DEMO_MODE === "true" && <p>Dados fictícios para validar os fluxos locais.</p>}
        </div>
      </div>
      <div className="account-layout">
        <nav className="account-nav" aria-label="Minha conta">
          {nav.map(([label, href]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
          <LogoutButton className="account-logout-button" />
        </nav>
        <section>
          {section === "perfil" && (
            <>
              {signupComplete && (
                <p className="form-message success account-welcome" role="status">
                  Cadastro realizado com sucesso. Complete seu perfil para aproveitar todos os
                  recursos da Curtiz.
                </p>
              )}
              <AccountProfile
                customerName={customerName}
                customerEmail={customerEmail}
                customerPhone={customerPhone}
                accountStatus={accountStatus}
                representative={session?.roles.includes("representative") ?? false}
              />
            </>
          )}
          {section === "conta" && <AccountSummary />}
          {section === "pedidos" && <Orders />}
          {section === "enderecos" && <Addresses />}
          {section === "favoritos" && <FavoritesPanel />}
          {section === "seguranca" && <Security />}
          {section === "trocas" && (
            <Empty title="Nenhuma troca em andamento" icon={<RotateCcw />} />
          )}
          {section === "atendimento" && (
            <SupportCenter accountMode startNew={startNewSupport} />
          )}
          {section === "privacidade" && <Privacy />}
        </section>
      </div>
    </div>
  );
}

function AccountProfile({
  customerName,
  customerEmail,
  customerPhone,
  accountStatus,
  representative
}: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  accountStatus: string;
  representative: boolean;
}) {
  return (
    <div className="form-stack">
      <article className="account-profile-card">
        <div className="account-avatar" aria-hidden="true">{customerName.slice(0, 1).toUpperCase()}</div>
        <div>
          <p className="eyebrow">Perfil Curtiz</p>
          <h2>{customerName}</h2>
          <p>Seus dados sensíveis permanecem protegidos e aparecem mascarados.</p>
        </div>
      </article>
      <article className="form-card account-personal-data">
        <div className="section-heading compact-heading">
          <div><p className="eyebrow">Dados pessoais</p><h2>Informações da conta</h2></div>
          <Link className="secondary-button compact-button" href="/minha-conta/conta">Editar</Link>
        </div>
        <dl>
          <div><dt>Nome</dt><dd>{customerName}</dd></div>
          <div><dt>E-mail</dt><dd>{customerEmail || "Não informado"}</dd></div>
          <div><dt>Telefone</dt><dd>{customerPhone || "Complete seu perfil"}</dd></div>
          <div><dt>Status</dt><dd><span className="status-pill">{accountStatus}</span></dd></div>
        </dl>
      </article>
      <article className="representative-account-card">
        <div>
          <p className="eyebrow">Programa de representantes</p>
          <h2>{representative ? "Seu portal está disponível" : "Tenha uma nova área profissional"}</h2>
          <p>{representative ? "Acesse vendas, materiais, rede e histórico em um ambiente separado." : "Envie uma solicitação, acompanhe a análise e preserve sua conta de cliente."}</p>
        </div>
        <Link className="primary-button" href={representative ? "/representante" : "/representante/solicitacao"}>
          {representative ? "Abrir portal" : "Quero ser representante"}
        </Link>
      </article>
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
      <button
        className="secondary-button"
        type="button"
        disabled
        title="Disponível após conectar o Supabase"
      >
        Adicionar endereço · não configurado
      </button>
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
        <button
          className="secondary-button"
          type="button"
          disabled
          title="Disponível após conectar o Supabase Auth"
        >
          Revisar sessões · não configurado
        </button>
      </div>
      <div className="form-card">
        <h2>Últimos acessos</h2>
        <p>Os dados serão carregados do Supabase Auth após a conexão local.</p>
      </div>
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
      <button
        className="secondary-button"
        type="button"
        disabled
        title="Disponível após conectar o fluxo LGPD"
      >
        Solicitar meus dados · não configurado
      </button>
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
