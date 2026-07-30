import { CreditCard, LockKeyhole, PackageCheck } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "./brand-logo";

const groups = [
  {
    title: "Institucional",
    links: [
      ["Quem somos", "/sobre"],
      ["Fale conosco", "/contato"],
      ["Privacidade", "/politica-de-privacidade"],
      ["Termos de uso", "/termos-de-uso"]
    ]
  },
  {
    title: "Ajuda",
    links: [
      ["Central de ajuda", "/ajuda"],
      ["Trocas e devoluções", "/trocas-e-devolucoes"],
      ["Formas de envio", "/formas-de-envio"],
      ["Formas de pagamento", "/formas-de-pagamento"]
    ]
  },
  {
    title: "Categorias",
    links: [
      ["Masculino", "/masculino"],
      ["Feminino", "/feminino"],
      ["Infantil", "/infantil"],
      ["Slides", "/slides"],
      ["Ofertas", "/ofertas"]
    ]
  }
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-trust">
        <div className="container">
          <span><PackageCheck /><strong>Entrega acompanhada</strong> do pedido ao destino</span>
          <span><LockKeyhole /><strong>Compra protegida</strong> em todas as etapas</span>
          <span><CreditCard /><strong>Pagamento flexível</strong> em até 6x sem juros</span>
        </div>
      </div>
      <div className="container footer-grid">
        <div className="footer-brand">
          <BrandLogo />
          <p>Conforto e estilo para todos os momentos, com uma experiência de compra clara e segura.</p>
          <span>Loja exclusivamente online.</span>
        </div>
        {groups.map((group) => (
          <nav aria-label={group.title} key={group.title}>
            <h2>{group.title}</h2>
            {group.links.map(([label, href]) => (
              <Link href={href} key={href}>{label}</Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="footer-bottom">
        <div className="container">
          <span>© 2026 Curtiz. Todos os direitos reservados.</span>
          <span>Ambiente demonstrativo · Identidade visual provisória</span>
        </div>
      </div>
    </footer>
  );
}
