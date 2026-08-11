import { ArrowRight, Boxes, ChartNoAxesCombined, ClipboardCheck, PanelsTopLeft, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import logoCurtiz from "../../../public/images/logo-curtiz.png";
import { PanelSelectorLogout } from "@/components/panel-selector-logout";
import { requirePanelSelectionAccess } from "@/lib/auth";

const icons = {
  administracao: Boxes,
  operacional: ClipboardCheck,
  gerencia: ChartNoAxesCombined,
  tecnico: Wrench
} as const;

export default async function PanelSelectorPage() {
  const access = await requirePanelSelectionAccess();
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  const firstName = access.fullName.trim().split(/\s+/)[0] || access.fullName;

  return (
    <main className="panel-selector-page">
      <section className="panel-selector-shell" aria-labelledby="panel-selector-title">
        <aside className="panel-selector-intro">
          <div className="panel-selector-brand"><Image src={logoCurtiz} alt="curti Z" width={180} height={120} priority /></div>
          <span className="panel-selector-eyebrow">Central de trabalho</span>
          <h1 id="panel-selector-title">Escolha o painel que deseja acessar</h1>
          <p>Cada ambiente organiza as tarefas e decisões específicas da sua função.</p>
          <div className="panel-selector-security">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Acesso protegido por função</strong><small>Você verá somente os painéis atribuídos à sua conta.</small></span>
          </div>
        </aside>

        <div className="panel-selector-workspace">
          <header className="panel-selector-header">
            <div>
              <span>Olá, {firstName}</span>
              <h2>{access.panels.length} {access.panels.length === 1 ? "ambiente disponível" : "ambientes disponíveis"}</h2>
            </div>
            <p>Você poderá trocar de painel sem encerrar a sessão.</p>
          </header>

          <div className="panel-selector-grid">
            {access.panels.map((panel) => {
              const Icon = icons[panel.routeRole] ?? PanelsTopLeft;
              return (
                <Link href={panel.href} key={panel.databaseRole} className="panel-selector-card">
                  <span className="panel-selector-icon"><Icon aria-hidden="true" /></span>
                  <span><strong>{panel.label}</strong><small>{panel.description}</small></span>
                  <span>Acessar <ArrowRight aria-hidden="true" /></span>
                </Link>
              );
            })}
          </div>

          <PanelSelectorLogout storeUrl={storeUrl} />
        </div>
      </section>
    </main>
  );
}
