import Link from "next/link";
import { BrandLogo } from "./brand-logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <BrandLogo />
          <p>Conforto e estilo para todos os momentos.</p>
        </div>
        <div>
          <h2>Institucional</h2>
          <Link href="/sobre">Quem somos</Link>
          <Link href="/contato">Fale conosco</Link>
          <Link href="/politica-de-privacidade">Privacidade</Link>
          <Link href="/termos-de-uso">Termos de uso</Link>
        </div>
        <div>
          <h2>Ajuda</h2>
          <Link href="/ajuda">Central de ajuda</Link>
          <Link href="/trocas-e-devolucoes">Trocas e devoluções</Link>
          <Link href="/formas-de-envio">Formas de envio</Link>
          <Link href="/formas-de-pagamento">Formas de pagamento</Link>
        </div>
        <div>
          <h2>Categorias</h2>
          <Link href="/masculino">Masculino</Link>
          <Link href="/feminino">Feminino</Link>
          <Link href="/infantil">Infantil</Link>
          <Link href="/ofertas">Ofertas</Link>
        </div>
      </div>
      <div className="footer-bottom">© 2026 Curtiz. Todos os direitos reservados.</div>
    </footer>
  );
}
