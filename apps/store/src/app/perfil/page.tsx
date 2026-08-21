import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { BadgeCheck, LockKeyhole, UserRound } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readRows, readString } from "@/lib/unknown-data";
import { RepresentativeAccessCard } from "@/components/representative-access-card";
import { ProfileAvatarManager } from "@/components/profile-avatar-manager";

export const metadata = { title: "Perfil", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const cookieStore = await cookies();
  const demoSession = verifyDemoSession(cookieStore.get(DEMO_SESSION_COOKIE)?.value);
  let fullName = demoSession?.fullName ?? null;
  let roles: string[] = demoSession ? [...demoSession.roles] : [];
  let avatarUrl = "";

  if (!demoSession) {
    const supabase = await createServerSupabaseClient();
    const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
    if (data.user && supabase) {
      const profileResponse = await supabase
        .from("profiles")
        .select("full_name,avatar_path")
        .eq("id", data.user.id)
        .maybeSingle();
      const profile = readQueryResult(profileResponse).data;
      fullName = isUnknownRecord(profile)
        ? readString(profile, "full_name")
        : "";
      if (!fullName) {
        fullName =
          typeof data.user.user_metadata.full_name === "string"
            ? data.user.user_metadata.full_name
            : "Cliente curti Z";
      }
      const avatarPath = isUnknownRecord(profile) ? readString(profile, "avatar_path") : "";
      if (avatarPath) {
        const signed = await supabase.storage
          .from("customer-private")
          .createSignedUrl(avatarPath, 300);
        avatarUrl = signed.data?.signedUrl ?? "";
      }
      const roleResponse: unknown = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id);
      roles = readRows(readQueryResult(roleResponse).data).map((item) => readString(item, "role"));
    }
  }

  if (!fullName) {
    return (
      <main className="container page-shell profile-entry-page account-experience-page">
        <section className="profile-empty-state">
          <span className="profile-empty-icon">
            <UserRound />
          </span>
          <p className="eyebrow">Seu espaço curti Z</p>
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
  const hasInternalRole = roles.some((role) =>
    ["admin", "manager", "operational", "technical"].includes(role)
  );
  const panelUrl = process.env.NEXT_PUBLIC_PANEL_URL?.trim() || "http://localhost:3001";
  const returnUrl = hasInternalRole ? `${panelUrl.replace(/\/$/, "")}/selecionar-painel` : "/minha-conta";
  return (
    <main className="container page-shell profile-page account-experience-page">
      <header className="profile-identity">
        <ProfileAvatarManager fullName={fullName} avatarUrl={avatarUrl} compact />
        <div>
          <p className="eyebrow">Perfil curti Z</p>
          <h1>{fullName}</h1>
          <p>Gerencie seus dados e acessos.</p>
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
              <dd>Disponível na área do cliente</dd>
            </div>
          </dl>
          <Link className="secondary-button" href={returnUrl}>
            {hasInternalRole ? "Voltar aos painéis" : "Voltar à área do cliente"}
          </Link>
        </section>
        <RepresentativeAccessCard active={isRepresentative} />
      </div>
    </main>
  );
}
