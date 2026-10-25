"use client";

import { useEffect } from "react";

const devtoolsLetters = new Set(["i", "j", "c"]);

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function isDevtoolsShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">) {
  const key = event.key.toLowerCase();
  if (event.key === "F12") return true;
  // Ctrl/Cmd+Shift+I/J/C (Windows/Linux) e Cmd+Option+I/J/C (macOS).
  if ((event.ctrlKey || event.metaKey) && (event.shiftKey || event.altKey) && devtoolsLetters.has(key)) return true;
  // Ctrl/Cmd+U (código-fonte).
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && key === "u";
}

export function DevtoolsGuard({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isDevtoolsShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      // Mantém o menu de colar/copiar em campos de formulário.
      if (!isEditable(event.target)) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [enabled]);

  return null;
}
