import { LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerAccount } from "@/components/customer-account";
import { loadCustomerAccount } from "@/lib/customer-account-data";
import { requestPublicAppUrls } from "@/lib/request-public-urls";

export const metadata = {
  title: "Minha conta",
  robots: { index: false, follow: false }
};
export const dynamic = "force-dynamic";

export default async function AccountPage({
  params,
  searchParams
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ pedido?: string; new?: string; cadastro?: string }>;
}) {
  const route = await params;
  const query = await searchParams;
  const section = route.section?.[0] ?? "visao-geral";
  const snapshot = await loadCustomerAccount();

  if (snapshot.panelDestination) {
    const { panelUrl } = await requestPublicAppUrls();
    redirect(
      new URL(snapshot.panelDestination, panelUrl).toString()
    );
  }

  if (!snapshot.authenticated) {
    const returnTo = `/minha-conta${section === "visao-geral" ? "" : `/${section}`}`;
    return (
      <main className="container page-shell customer-entry-page account-experience-page">
        <section className="customer-entry-card">
          <span className="customer-entry-icon" aria-hidden="true">
            <UserRound />
          </span>
          <p className="eyebrow">Área do cliente</p>
          <h1>Entre na sua conta curti Z</h1>
          <p>
            Consulte pedidos, favoritos, endereços, avaliações e atendimentos em um só lugar.
          </p>
          <div className="customer-entry-actions">
            <Link className="primary-button" href={`/login?next=${encodeURIComponent(returnTo)}`}>
              Entrar
            </Link>
            <Link
              className="secondary-button"
              href={`/cadastro?next=${encodeURIComponent("/minha-conta/perfil")}`}
            >
              Criar conta
            </Link>
          </div>
          <small>
            <LockKeyhole aria-hidden="true" />
            Você retornará automaticamente para esta área após o acesso.
          </small>
        </section>
      </main>
    );
  }

  return (
    <CustomerAccount
      snapshot={snapshot}
      section={section}
      selectedOrderCode={query.pedido ?? ""}
      startNewSupport={query.new === "1"}
      signupComplete={query.cadastro === "sucesso"}
    />
  );
}
