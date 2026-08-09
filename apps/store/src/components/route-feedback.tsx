"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

function RouteFeedbackInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setLoading(false);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }, [pathname, searchParams]);

  useEffect(() => {
    const startLoading = () => {
      setLoading(true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setLoading(false), 8_000);
    };
    const startForAnchor = (anchor: HTMLAnchorElement | null) => {
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      ) return;
      startLoading();
    };
    const start = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;
      startForAnchor(target.closest<HTMLAnchorElement>("a[href]"));
    };
    const startFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element)
        startForAnchor(target.closest<HTMLAnchorElement>("a[href]"));
    };
    const startFromHistory = () => startLoading();

    document.addEventListener("click", start, true);
    document.addEventListener("keydown", startFromKeyboard, true);
    window.addEventListener("popstate", startFromHistory);
    return () => {
      document.removeEventListener("click", start, true);
      document.removeEventListener("keydown", startFromKeyboard, true);
      window.removeEventListener("popstate", startFromHistory);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      className={loading ? "route-progress is-loading" : "route-progress"}
      role="progressbar"
      aria-label="Carregando página"
      aria-hidden={!loading}
    >
      <span />
    </div>
  );
}

export function RouteFeedback() {
  return (
    <Suspense fallback={null}>
      <RouteFeedbackInner />
    </Suspense>
  );
}
