import { Boxes, ChartNoAxesCombined, ClipboardCheck, PanelsTopLeft, Wrench } from "lucide-react";
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
  const fallbackHref = access.panels[0]?.href ?? "/";

  return (
    <main className="panel-selector-page">
      <section className="panel-selector-shell" aria-labelledby="panel-selector-title">
        <div className="panel-selector-workspace">
          <div className="panel-selector-brand">
            <Image src={logoCurtiz} alt="curti Z" width={180} height={120} priority />
          </div>
          <header className="panel-selector-header">
            <h1 id="panel-selector-title">Escolha um painel</h1>
          </header>

          <div className="panel-selector-grid">
            {access.panels.map((panel) => {
              const Icon = icons[panel.routeRole] ?? PanelsTopLeft;
              return (
                <Link href={panel.href} key={panel.databaseRole} className="panel-selector-card">
                  <span className="panel-selector-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <strong>{panel.label}</strong>
                </Link>
              );
            })}
          </div>

          <PanelSelectorLogout storeUrl={storeUrl} fallbackHref={fallbackHref} />
        </div>
      </section>
    </main>
  );
}
