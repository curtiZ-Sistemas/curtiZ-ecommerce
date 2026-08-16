import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { connection } from "next/server";
import { CartProvider } from "@/components/cart-provider";
import { FavoritesProvider } from "@/components/favorites-provider";
import { HelpChat } from "@/components/help-chat";
import { RouteFeedback } from "@/components/route-feedback";
import { CookiePreferences } from "@/components/cookie-preferences";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const storeDescription = "Chinelos, slides e sandálias curti Z com conforto, design e compra organizada.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000"),
  title: {
    default: "curti Z — conforto e estilo para todos os momentos",
    template: "%s — curti Z"
  },
  description: storeDescription,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "curti Z",
    title: "curti Z — conforto e estilo para todos os momentos",
    description: storeDescription,
    url: "/"
  },
  twitter: {
    card: "summary",
    title: "curti Z — conforto e estilo para todos os momentos",
    description: storeDescription
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A CSP usa um nonce exclusivo por requisição; o HTML não pode ser pré-renderizado sem ele.
  await connection();

  return (
    <html lang="pt-BR" className={manrope.variable} data-scroll-behavior="smooth">
      <body>
        <CartProvider>
          <FavoritesProvider>
            <a className="skip-link" href="#main-content">
              Ir para o conteúdo principal
            </a>
            <RouteFeedback />
            <SiteHeader />
            <main id="main-content">{children}</main>
            <SiteFooter />
            <HelpChat />
            <CookiePreferences />
          </FavoritesProvider>
        </CartProvider>
      </body>
    </html>
  );
}
