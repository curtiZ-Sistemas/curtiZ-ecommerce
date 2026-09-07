"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function PanelDrawer({ open, title, eyebrow, dirty = false, busy = false, size = "medium", onClose, children }: {
  open: boolean;
  title: string;
  eyebrow?: string;
  dirty?: boolean;
  busy?: boolean;
  size?: "small" | "medium" | "large";
  onClose: () => void;
  children: ReactNode | ((controls: { requestClose: () => void }) => ReactNode);
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [busy, dirty, onClose]);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") requestCloseRef.current(); };
    document.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (confirmDiscard) drawerRef.current?.querySelector<HTMLButtonElement>('[role="alertdialog"] button')?.focus();
  }, [confirmDiscard]);

  useEffect(() => { if (!open) setConfirmDiscard(false); }, [open]);
  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const scope = drawerRef.current?.querySelector('[role="alertdialog"]') ?? drawerRef.current;
    const controls = Array.from(scope?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => element.getClientRects().length > 0);
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return createPortal(
    <div className="panel-drawer-layer">
      <button className="panel-drawer-backdrop" type="button" onClick={requestClose} disabled={busy} tabIndex={-1} aria-label="Fechar painel lateral" />
      <aside className={`panel-drawer panel-drawer-${size}`} ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="panel-drawer-title" onKeyDown={trapFocus}>
        <header className="panel-drawer-header"><div>{eyebrow ? <span>{eyebrow}</span> : null}<h2 id="panel-drawer-title">{title}</h2></div><button ref={closeRef} type="button" onClick={requestClose} disabled={busy} aria-label="Fechar"><X aria-hidden="true" /></button></header>
        <div className="panel-drawer-content">{typeof children === "function" ? children({ requestClose }) : children}</div>
        {confirmDiscard ? <div className="panel-drawer-confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><div><h3 id="discard-title">Descartar alterações?</h3><p>As informações ainda não salvas serão perdidas.</p><footer><button className="secondary-button" type="button" onClick={() => setConfirmDiscard(false)}>Continuar editando</button><button className="danger-button" type="button" onClick={onClose}>Descartar</button></footer></div></div> : null}
      </aside>
    </div>, document.body
  );
}
