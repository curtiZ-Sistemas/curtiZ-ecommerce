import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Painel curti Z", template: "%s — Painel curti Z" },
  description: "Operação interna curti Z",
  robots: { index: false, follow: false, noarchive: true }
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // O nonce da CSP nasce no middleware e exige renderização por requisição.
  await connection();

  return (
    <html lang="pt-BR" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
