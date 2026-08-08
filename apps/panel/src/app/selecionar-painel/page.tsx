import { Boxes, ChartNoAxesCombined, ClipboardCheck, PanelsTopLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { PanelSelectorLogout } from "@/components/panel-selector-logout";
import { requirePanelSelectionAccess } from "@/lib/auth";

const icons = {
  administracao: Boxes,
  operacional: ClipboardCheck,
  gerencia: ChartNoAxesCombined
} as const;

export default async function PanelSelectorPage() {
  const access = await requirePanelSelectionAccess();
  const storeUrl = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000";
  const firstName = access.fullName.trim().split(/\s+/)[0] || access.fullName;

  return (
    <main className="panel-selector-page">
      <section className="panel-selector-shell" aria-labelledby="panel-selector-title">
        <header className="panel-selector-header">
          <div className="panel-selector-brand"><Image src="/images/logo-curtiz.png" alt="curti Z" width={180} height={120} priority /></div>
          <p>Olá, {firstName}.</p>
          <h1 id="panel-selector-title">Escolha o painel que deseja acessar</h1>
          <p>Você pode trocar de painel a qualquer momento sem sair da sua conta.</p>
        </header>

        <div className="panel-selector-grid">
          {access.panels.map((panel) => {
            const Icon = icons[panel.routeRole as keyof typeof icons] ?? PanelsTopLeft;
            return (
              <Link href={panel.href} key={panel.databaseRole} className="panel-selector-card">
                <span className="panel-selector-icon"><Icon aria-hidden="true" /></span>
                <span><strong>{panel.label}</strong><small>{panel.description}</small></span>
                <span aria-hidden="true">Acessar →</span>
              </Link>
            );
          })}
        </div>

        <PanelSelectorLogout storeUrl={storeUrl} />
      </section>
    </main>
  );
}
