import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false, noarchive: true }
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
