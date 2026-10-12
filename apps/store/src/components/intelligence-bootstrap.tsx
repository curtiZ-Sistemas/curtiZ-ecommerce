"use client";

import { useEffect } from "react";
import {
  applyIntelligenceConsent,
  flushIntelligence,
  startIntelligence
} from "../lib/intelligence-client";
import { consentChangedEvent } from "../lib/privacy/consent-client";

export function IntelligenceBootstrap() {
  useEffect(() => {
    startIntelligence();
    const flush = () => {
      if (document.visibilityState === "hidden") void flushIntelligence(true);
    };
    const consent = () => applyIntelligenceConsent();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener(consentChangedEvent, consent);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener(consentChangedEvent, consent);
      void flushIntelligence(true);
    };
  }, []);
  return null;
}
