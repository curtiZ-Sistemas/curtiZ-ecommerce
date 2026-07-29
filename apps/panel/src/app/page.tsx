import Link from "next/link";

export default function PanelLogin() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <section className="panel-card" style={{ width: "min(100%, 460px)", padding: 32 }}>
        <div className="panel-brand">
          CURTI<span>Z</span>
        </div>
        <p className="demo-status">Ambiente de demonstração</p>
        <h1>Acesso interno</h1>
        <p>O cargo é identificado pelo servidor. Não existe seletor de perfil no login.</p>
        <form style={{ display: "grid", gap: 14 }}>
          <label>
            E-mail corporativo
            <input
              style={{ width: "100%", minHeight: 44, marginTop: 6 }}
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Senha
            <input
              style={{ width: "100%", minHeight: 44, marginTop: 6 }}
              type="password"
              autoComplete="current-password"
              minLength={10}
              required
            />
          </label>
          <button className="primary-button">Entrar com MFA</button>
        </form>
        <p style={{ fontSize: ".75rem", color: "var(--muted)" }}>
          Sem Supabase conectado, use os painéis de demonstração abaixo.
        </p>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <Link className="secondary-button" href="/operacional">
            Operacional
          </Link>
          <Link className="secondary-button" href="/administracao">
            Admin
          </Link>
          <Link className="secondary-button" href="/gerencia">
            Gerência
          </Link>
          <Link className="secondary-button" href="/tecnico">
            Técnico
          </Link>
        </div>
      </section>
    </main>
  );
}
