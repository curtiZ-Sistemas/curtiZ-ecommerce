import type { NextRequest } from "next/server";
import { CONSENT_COOKIE, consentSigningKey, verifyConsentToken, type ConsentToken } from "./consent-token";

/** Escolha válida (assinada, vigente e da versão atual) enviada pelo navegador, ou null. */
export function readServerConsent(request: NextRequest): ConsentToken | null {
  return verifyConsentToken(request.cookies.get(CONSENT_COOKIE)?.value, consentSigningKey());
}

export function hasServerConsent(
  request: NextRequest,
  category: "preferences" | "analytics" | "marketing"
) {
  return readServerConsent(request)?.categories[category] === true;
}
