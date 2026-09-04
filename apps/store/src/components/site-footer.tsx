import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { CookieSettingsButton } from "./cookie-preferences";

const groups = [
  {
    title: "Comprar",
    links: [
      ["Todos os produtos", "/produtos"],
      ["Chinelos e slides masculinos", "/masculino"],
      ["Chinelos e sandálias femininas", "/feminino"],
      ["Chinelos e sandálias infantis", "/infantil"],
      ["Lançamentos", "/lancamentos"]
    ]
  },
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

export function SiteFooter() {
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
      <div className="footer-bottom">
        <div className="container">
          <span>© 2026 curti Z. Todos os direitos reservados.</span>
          <CookieSettingsButton />
        </div>
      </div>
    </footer>
  );
}
