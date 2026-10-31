import { Boxes, ChartNoAxesCombined, ChevronRight, ClipboardCheck, PanelsTopLeft, Wrench } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import logoCurtiz from "../../../public/images/logo-curtiz.webp";
import { panelPurposes } from "@/components/panel-identity";
import { PanelSelectorLogout } from "@/components/panel-selector-logout";
import { requirePanelSelectionAccess } from "@/lib/auth";
import { requestPublicAppUrls } from "@/lib/request-public-urls";

const icons = {
  administracao: Boxes,
  operacional: ClipboardCheck,
  gerencia: ChartNoAxesCombined,
  tecnico: Wrench
} as const;

export default async function PanelSelectorPage() {
  const access = await requirePanelSelectionAccess();
  const { storeUrl } = await requestPublicAppUrls();
  const fallbackHref = access.panels[0]?.href ?? "/";
  const firstName = access.fullName === "Usuário" ? "" : access.fullName.trim().split(/\s+/)[0];

  return (
    <main className="panel-picker">
      <section className="panel-picker-sheet" aria-labelledby="panel-selector-title">
        <Image className="panel-picker-brand" src={logoCurtiz} alt="curti Z" width={180} height={120} priority />
        <header className="panel-picker-header">
          {firstName ? <p>Olá, {firstName}</p> : null}
          <h1 id="panel-selector-title">Escolha um painel</h1>
        </header>

        <ul className="panel-picker-list">
          {access.panels.map((panel) => {
            const Icon = icons[panel.routeRole] ?? PanelsTopLeft;
            return (
              <li key={panel.databaseRole}>
                <Link href={panel.href} className="panel-picker-option">
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{panel.label}</strong>
                    <small>{panelPurposes[panel.routeRole]}</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>

        <PanelSelectorLogout storeUrl={storeUrl} fallbackHref={fallbackHref} />
      </section>
    </main>
  );
}
