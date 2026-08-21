"use client";

import { useEffect } from "react";
import {
  applyIntelligenceConsent,
  flushIntelligence,
  trackIntelligence
} from "../lib/intelligence-client";

export function IntelligenceBootstrap() {
  useEffect(() => {
    trackIntelligence({ type: "page_view" });
    const flush = () => {
      if (document.visibilityState === "hidden") void flushIntelligence(true);
    };
    const consent = () => applyIntelligenceConsent();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("curtiz-consent-changed", consent);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("curtiz-consent-changed", consent);
      void flushIntelligence(true);
    };
  }, []);
  return null;
}
