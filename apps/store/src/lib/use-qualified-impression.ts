"use client";

import { useEffect, type RefObject } from "react";
import { trackIntelligence, type IntelligenceEvent } from "./intelligence-client";

const recorded = new Set<string>();

export function useQualifiedImpression(
  ref: RefObject<Element | null>,
  key: string,
  event: IntelligenceEvent
) {
  useEffect(() => {
    const node = ref.current;
    if (!node || recorded.has(key)) return;
    let dwell: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          dwell ??= window.setTimeout(() => {
            recorded.add(key);
            trackIntelligence(event);
            observer.disconnect();
          }, 800);
        } else if (dwell !== undefined) {
          window.clearTimeout(dwell);
          dwell = undefined;
        }
      },
      { threshold: [0, 0.6] }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (dwell !== undefined) window.clearTimeout(dwell);
    };
  }, [event, key, ref]);
}
