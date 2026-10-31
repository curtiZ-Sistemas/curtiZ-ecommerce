import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { CookieSettingsButton } from "./cookie-preferences";
import { formatCnpj, type CompanyIdentification } from "../lib/company-identification";
import type { StoreNavigationItem } from "@/lib/store-navigation-core";

const institutionalGroups = [
  {
    title: "Institucional",
    links: [
      ["Quem somos", "/sobre"],
      ["Fale conosco", "/contato"],
      ["Atendimento", "/ajuda"]
    ]
  },
  {
    title: "Políticas",
    links: [
      ["Centro de políticas", "/politicas"],
      ["Termos", "/politicas/termos-de-uso"],
      ["Privacidade", "/politicas/aviso-de-privacidade"],
      ["Cookies", "/politicas/politica-de-cookies"],
      ["Trocas e devoluções", "/trocas-e-devolucoes"],
      ["Formas de envio", "/formas-de-envio"],
      ["Formas de pagamento", "/formas-de-pagamento"],
      ["Garantia", "/politicas/garantia"],
      ["Acessibilidade", "/politicas/acessibilidade"]
    ]
  },
  {
    title: "Representantes",
    links: [
      ["Termos", "/politicas/termos-representante"],
      ["Kits e qualificação", "/politicas/kits-e-qualificacao"],
      ["Comissões", "/politicas/comissoes"],
      ["Uso da marca", "/politicas/criativos"]
    ]
  }
] as const;

export function footerShoppingLinks(navigation: StoreNavigationItem[]): Array<readonly [string, string]> {
  const links: Array<readonly [string, string]> = [["Todos os produtos", "/produtos"]];
  const seen = new Set<string>();
  for (const item of navigation) {
    const url = new URL(item.href, "https://curtiz.com.br");
    const category = url.pathname === "/produtos" ? url.searchParams.get("categoria") : null;
    const slug = category?.trim().toLocaleLowerCase("pt-BR");
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      links.push([item.label, item.href]);
    } else if (item.href === "/lancamentos" && !seen.has("launches")) {
      seen.add("launches");
      links.push([item.label, item.href]);
    }
  }
  return links;
}

export function SiteFooter({
  navigation,
  company = null
}: {
  navigation: StoreNavigationItem[];
  company?: CompanyIdentification | null;
}) {
  const groups = [{ title: "Comprar", links: footerShoppingLinks(navigation) }, ...institutionalGroups];
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <BrandLogo />
          <p>
            A loja oficial curti Z em curtiz.com.br reúne conforto e estilo em uma experiência de
            compra clara e organizada.
          </p>
          <span>Loja exclusivamente online.</span>
        </div>
        {groups.map((group) => (
          <nav className="footer-navigation" aria-label={group.title} key={group.title}>
            <div className="footer-desktop-group">
              <h2>{group.title}</h2>
              {group.links.map(([label, href]) => (
                <Link href={href} prefetch={false} key={href}>
                  {label}
                </Link>
              ))}
            </div>
            <details className="footer-group">
              <summary>
                <h2>{group.title}</h2>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="footer-group-links">
                {group.links.map(([label, href]) => (
                  <Link href={href} prefetch={false} key={href}>
                    {label}
                  </Link>
                ))}
              </div>
            </details>
          </nav>
        ))}
      </div>
      {company ? (
        <section className="footer-legal" aria-label="Identificação do fornecedor">
          <dl className="container footer-legal-list">
            <div>
              <dt>Razão social</dt>
              <dd>{company.legalName}</dd>
            </div>
            <div>
              <dt>CNPJ</dt>
              <dd>{formatCnpj(company.taxId)}</dd>
            </div>
            <div>
              <dt>Endereço</dt>
              <dd>{company.address}</dd>
            </div>
            {company.email || company.phone ? (
              <div>
                <dt>Contato</dt>
                <dd>
                  {company.email ? <a href={`mailto:${company.email}`}>{company.email}</a> : null}
                  {company.email && company.phone ? <br /> : null}
                  {company.phone}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      <div className="footer-bottom">
        <div className="container">
          <span>© {new Date().getFullYear()} curti Z. Todos os direitos reservados.</span>
          <CookieSettingsButton />
        </div>
      </div>
    </footer>
  );
}
