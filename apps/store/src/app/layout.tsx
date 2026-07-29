import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { CartProvider } from "@/components/cart-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3000"),
  title: {
    default: "Curtiz — conforto e estilo para todos os momentos",
    template: "%s — Curtiz"
  },
  description: "Chinelos, slides e sandálias Curtiz com conforto, design e compra segura.",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Curtiz"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const demo = process.env.DEMO_MODE !== "false";
  return (
    <html lang="pt-BR" className={manrope.variable} data-scroll-behavior="smooth">
      <body>
        <CartProvider>
          {demo && (
            <div className="demo-banner">
              Ambiente de demonstração — produtos, pedidos e integrações exibidos são fictícios.
            </div>
          )}
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </CartProvider>
      </body>
    </html>
  );
}
