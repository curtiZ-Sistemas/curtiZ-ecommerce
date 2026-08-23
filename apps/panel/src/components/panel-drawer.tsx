"use client";

import { X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function PanelDrawer({ open, title, eyebrow, dirty = false, size = "medium", onClose, children }: {
  open: boolean;
  title: string;
  eyebrow?: string;
  dirty?: boolean;
  size?: "small" | "medium" | "large";
  onClose: () => void;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = useCallback(() => dirty ? setConfirmDiscard(true) : onClose(), [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeRef.current?.focus(), 0);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
      restoreFocusRef.current?.focus();
    };
  }, [open, requestClose]);

  useEffect(() => { if (!open) setConfirmDiscard(false); }, [open]);
  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const controls = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return (
    <div className="panel-drawer-layer">
      <button className="panel-drawer-backdrop" type="button" onClick={requestClose} aria-label="Fechar painel lateral" />
      <aside className={`panel-drawer panel-drawer-${size}`} ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="panel-drawer-title" onKeyDown={trapFocus}>
        <header className="panel-drawer-header"><div>{eyebrow ? <span>{eyebrow}</span> : null}<h2 id="panel-drawer-title">{title}</h2></div><button ref={closeRef} type="button" onClick={requestClose} aria-label="Fechar"><X aria-hidden="true" /></button></header>
        <div className="panel-drawer-content">{children}</div>
        {confirmDiscard ? <div className="panel-drawer-confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><div><h3 id="discard-title">Descartar alterações?</h3><p>As informações ainda não salvas serão perdidas.</p><footer><button className="secondary-button" type="button" onClick={() => setConfirmDiscard(false)}>Continuar editando</button><button className="danger-button" type="button" onClick={onClose}>Descartar</button></footer></div></div> : null}
      </aside>
    </div>
  );
}
