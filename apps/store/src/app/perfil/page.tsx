import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { BadgeCheck, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readQueryResult, readRows, readString } from "@/lib/unknown-data";
import { RepresentativeAccessCard } from "@/components/representative-access-card";

export const metadata = { title: "Perfil", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const demoSession =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  let fullName = demoSession?.fullName ?? null;
  let roles: string[] = demoSession ? [...demoSession.roles] : [];

  if (!demoSession && process.env.DEMO_MODE !== "true") {
    const supabase = await createServerSupabaseClient();
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (data.user && supabase) {
      fullName =
        typeof data.user.user_metadata.full_name === "string"
          ? data.user.user_metadata.full_name
          : "Cliente Curtiz";
      const roleResponse: unknown = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      roles = readRows(readQueryResult(roleResponse).data).map((item) => readString(item, "role"));
    }
  }

  if (!fullName) {
    return (
      <main className="container page-shell profile-entry-page">
        <section className="profile-empty-state">
          <span className="profile-empty-icon">
            <UserRound />
          </span>
          <p className="eyebrow">Seu espaço Curtiz</p>
          <h1>Acesse seu perfil</h1>
          <p>
            Entre para consultar seus dados, compras e o andamento de uma solicitação de
            representante.
          </p>
          <div className="profile-entry-actions">
            <Link className="primary-button" href="/login?next=/perfil">
              Entrar
            </Link>
            <Link className="secondary-button" href="/cadastro?next=/perfil">
              Criar conta
            </Link>
          </div>
          <small>
            <LockKeyhole /> O retorno ao perfil acontece automaticamente após o acesso.
          </small>
        </section>
      </main>
    );
  }

  const isRepresentative = roles.includes("representative");
  return (
    <main className="container page-shell profile-page">
      <header className="profile-identity">
        <span className="account-avatar" aria-hidden="true">
          {fullName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">Perfil Curtiz</p>
          <h1>{fullName}</h1>
          <p>Conta verificada · dados pessoais protegidos</p>
        </div>
        <BadgeCheck aria-label="Conta verificada" />
      </header>
      <div className="profile-dashboard-grid">
        <section className="profile-info-card">
          <h2>Dados pessoais</h2>
          <dl>
            <div>
              <dt>Nome</dt>
              <dd>{fullName}</dd>
            </div>
            <div>
              <dt>Documento</dt>
              <dd>•••.•••.•••-••</dd>
            </div>
            <div>
              <dt>Contato</dt>
              <dd>Protegido</dd>
            </div>
          </dl>
          <Link className="secondary-button" href="/minha-conta">
            Gerenciar perfil
          </Link>
        </section>
        <RepresentativeAccessCard active={isRepresentative} />
      </div>
    </main>
  );
}
