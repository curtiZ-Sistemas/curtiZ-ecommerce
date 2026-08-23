"use client";

import type { PromotionBarMessage } from "@curtiz/domain";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const ROTATION_INTERVAL_MS = 5_000;

export function PromotionBar({ messages }: { messages: readonly PromotionBarMessage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const pointerStart = useRef<number | undefined>(undefined);
  const hasRotation = messages.length > 1;

  const showRelative = useCallback(
    (offset: number) => {
      setActiveIndex((current) => (current + offset + messages.length) % messages.length);
    },
    [messages.length]
  );

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, messages.length - 1)));
  }, [messages.length]);

  useEffect(() => {
    if (!hasRotation) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;

    const schedule = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (document.hidden || reducedMotion.matches) return;
      timer = window.setInterval(() => showRelative(1), ROTATION_INTERVAL_MS);
    };

    schedule();
    document.addEventListener("visibilitychange", schedule);
    reducedMotion.addEventListener("change", schedule);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      reducedMotion.removeEventListener("change", schedule);
    };
  }, [hasRotation, showRelative]);

  if (messages.length === 0) return null;
  const activeMessage = messages[activeIndex] ?? messages[0]!;
  const content = (
    <>
      <span>{activeMessage.text}</span>
      {activeMessage.cta ? <strong>{activeMessage.cta}</strong> : null}
    </>
  );

  return (
    <aside
      className="promotion-bar"
      aria-label="Comunicados da loja"
      onPointerDown={(event) => {
        pointerStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const start = pointerStart.current;
        pointerStart.current = undefined;
        if (!hasRotation || start === undefined) return;
        const distance = event.clientX - start;
        if (Math.abs(distance) >= 36) showRelative(distance < 0 ? 1 : -1);
      }}
      onPointerCancel={() => {
        pointerStart.current = undefined;
      }}
    >
      <div className="promotion-bar-inner container">
        {hasRotation ? (
          <button
            className="promotion-bar-control previous"
            type="button"
            onClick={() => showRelative(-1)}
            aria-label="Comunicado anterior"
          >
            <ChevronLeft />
          </button>
        ) : null}
        <div className="promotion-bar-message" key={activeMessage.id}>
          {activeMessage.href ? (
            <Link href={activeMessage.href}>{content}</Link>
          ) : (
            <p>{content}</p>
          )}
        </div>
        {hasRotation ? (
          <button
            className="promotion-bar-control next"
            type="button"
            onClick={() => showRelative(1)}
            aria-label="Próximo comunicado"
          >
            <ChevronRight />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
