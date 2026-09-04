"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { hasConsentCategory } from "../lib/privacy/consent-client";

const device = () => window.innerWidth <= 700 ? "mobile" : window.innerWidth <= 1024 ? "tablet" : "desktop";
const sendMetric = (versionId: string, metric: "view" | "click", itemKey = "") => {
  if (!hasConsentCategory("analytics")) return;
  void fetch("/api/homepage-metrics", { method: "POST", headers: { "content-type": "application/json" }, keepalive: true, body: JSON.stringify({ versionId, metric, itemKey, device: device() }) }).catch(() => undefined);
};

export function HomepageMetric({ versionId, children }: { versionId?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!versionId || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { sendMetric(versionId, "view"); observer.disconnect(); } }, { threshold: .35 });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [versionId]);
  const click = (event: MouseEvent<HTMLDivElement>) => {
    if (!versionId) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-home-item]");
    if (element) sendMetric(versionId, "click", element.dataset.homeItem ?? "");
  };
  return <div className="homepage-section-metric" ref={ref} onClick={click}>{children}</div>;
}

export function HomepageCountdown({ endsAt }: { endsAt: string }) {
  const remaining = () => Math.max(0, Date.parse(endsAt) - Date.now());
  const [milliseconds, setMilliseconds] = useState(remaining);
  useEffect(() => { const timer = window.setInterval(() => setMilliseconds(remaining()), 1000); return () => window.clearInterval(timer); }, [endsAt]);
  const seconds = Math.floor(milliseconds / 1000); const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60); const rest = seconds % 60;
  return <div className="home-countdown" role="timer" aria-live="off"><span><strong>{days}</strong>dias</span><span><strong>{String(hours).padStart(2, "0")}</strong>horas</span><span><strong>{String(minutes).padStart(2, "0")}</strong>min</span><span><strong>{String(rest).padStart(2, "0")}</strong>seg</span></div>;
}
