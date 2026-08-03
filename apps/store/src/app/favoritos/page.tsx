import { FavoritesPanel } from "@/components/favorites-panel";

export const metadata = {
  title: "Favoritos",
  description: "Produtos que você salvou para consultar novamente.",
  robots: { index: false, follow: true }
};

export default function FavoritesPage() {
  return (
    <div className="container page-shell">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Sua seleção</p>
          <h1>Favoritos</h1>
          <p>Salvos neste dispositivo. Você pode montar sua lista antes de entrar.</p>
        </div>
      </div>
      <FavoritesPanel />
    </div>
  );
}
