"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export function PaymentDocumentBoundary({
  mercadoPagoAllowed,
  children
}: {
  mercadoPagoAllowed: boolean;
  children: ReactNode;
}) {
  // The root layout survives client navigation; CSP belongs to its initial document.
  const [documentAllowsMercadoPago] = useState(mercadoPagoAllowed);
  const pathname = usePathname();
  const paymentPage = pathname === "/checkout" || pathname.startsWith("/checkout/") ||
    /^\/pedido\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/pagamento\/?$/iu.test(pathname);
  const needsDocumentNavigation = paymentPage && !documentAllowsMercadoPago;

  useEffect(() => {
    if (needsDocumentNavigation) window.location.replace(window.location.href);
  }, [needsDocumentNavigation]);

  if (needsDocumentNavigation) {
    return <p className="container page-shell" role="status">Carregando checkout…</p>;
  }

  return children;
}
