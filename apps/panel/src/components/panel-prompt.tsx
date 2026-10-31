"use client";

import React, { createContext, type FormEvent, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from "react";

type PanelPromptOptions = {
  title: string;
  label?: string;
  defaultValue?: string;
  multiline?: boolean;
  inputType?: "text" | "number" | "datetime-local";
  inputMode?: "text" | "numeric" | "decimal";
  minLength?: number;
  confirmLabel?: string;
};

export type PanelConfirmOptions = {
  title: string;
  /** Consequência da ação, em uma ou duas frases. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

type PendingPrompt = PanelPromptOptions & { resolve: (value: string | null) => void };
type PendingConfirm = PanelConfirmOptions & { resolve: (value: boolean) => void };
type PanelPromptRequest = (options: PanelPromptOptions) => Promise<string | null>;
type PanelConfirmRequest = (options: PanelConfirmOptions) => Promise<boolean>;

const PanelPromptContext = createContext<PanelPromptRequest | null>(null);
const PanelConfirmContext = createContext<PanelConfirmRequest | null>(null);

// Escape fecha, Tab circula dentro do diálogo, a rolagem do fundo fica travada e o foco volta ao gatilho.
function useDialogBehavior(open: boolean, dialogRef: RefObject<HTMLElement | null>, onEscape: () => void) {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      const target = returnFocusRef.current;
      if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
    };
  }, [dialogRef, onEscape, open]);
}

export function PanelPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [value, setValue] = useState("");
  const resolverRef = useRef<PendingPrompt["resolve"] | null>(null);
  const confirmResolverRef = useRef<PendingConfirm["resolve"] | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLElement>(null);

  const close = useCallback((result: string | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setPending(null);
    setValue("");
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
    setPendingConfirm(null);
  }, []);

  const cancelPrompt = useCallback(() => close(null), [close]);
  const cancelConfirm = useCallback(() => closeConfirm(false), [closeConfirm]);

  const requestPrompt = useCallback<PanelPromptRequest>((options) => {
    resolverRef.current?.(null);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setValue(options.defaultValue ?? "");
      setPending({ ...options, resolve });
    });
  }, []);

  const requestConfirm = useCallback<PanelConfirmRequest>((options) => {
    confirmResolverRef.current?.(false);
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setPendingConfirm({ ...options, resolve });
    });
  }, []);

  useDialogBehavior(Boolean(pending), dialogRef, cancelPrompt);
  useDialogBehavior(Boolean(pendingConfirm), confirmRef, cancelConfirm);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (normalized.length < (pending?.minLength ?? 1)) return;
    close(normalized);
  };

  const confirmTone = pendingConfirm?.tone ?? "default";

  return (
    <PanelPromptContext.Provider value={requestPrompt}>
      <PanelConfirmContext.Provider value={requestConfirm}>
        {children}
        {pending ? (
          <div className="admin-modal-backdrop" role="presentation">
            <section
              ref={dialogRef}
              className="admin-confirm panel-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="panel-prompt-title"
            >
              <h2 id="panel-prompt-title">{pending.title}</h2>
              <form className="panel-prompt-form" onSubmit={submit}>
                <label>
                  <span>{pending.label ?? "Informação"}</span>
                  {pending.multiline !== false ? (
                    <textarea
                      autoFocus
                      rows={4}
                      minLength={pending.minLength ?? 1}
                      maxLength={1000}
                      required
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  ) : (
                    <input
                      autoFocus
                      type={pending.inputType ?? "text"}
                      inputMode={pending.inputMode}
                      minLength={pending.inputType === "text" ? pending.minLength ?? 1 : undefined}
                      required
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  )}
                </label>
                <div>
                  <button className="secondary-button" type="button" onClick={() => close(null)}>
                    Cancelar
                  </button>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={value.trim().length < (pending.minLength ?? 1)}
                  >
                    {pending.confirmLabel ?? "Confirmar"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
        {pendingConfirm ? (
          <div className="admin-modal-backdrop" role="presentation">
            <section
              ref={confirmRef}
              className="admin-confirm panel-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="panel-confirm-title"
              aria-describedby={pendingConfirm.description ? "panel-confirm-description" : undefined}
              data-tone={confirmTone}
            >
              <h2 id="panel-confirm-title">{pendingConfirm.title}</h2>
              {pendingConfirm.description ? <p id="panel-confirm-description">{pendingConfirm.description}</p> : null}
              <div className="panel-confirm-actions">
                {/* Foco inicial em Cancelar: a escolha segura é a mais fácil. */}
                <button className="secondary-button" type="button" autoFocus onClick={() => closeConfirm(false)}>
                  {pendingConfirm.cancelLabel ?? "Cancelar"}
                </button>
                <button
                  className={confirmTone === "danger" ? "danger-button" : "primary-button"}
                  type="button"
                  onClick={() => closeConfirm(true)}
                >
                  {pendingConfirm.confirmLabel ?? "Confirmar"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </PanelConfirmContext.Provider>
    </PanelPromptContext.Provider>
  );
}

export function usePanelPrompt(): PanelPromptRequest {
  const requestPrompt = useContext(PanelPromptContext);
  if (!requestPrompt) throw new Error("usePanelPrompt deve ser usado dentro de PanelPromptProvider.");
  return requestPrompt;
}

/** Substitui window.confirm: resolve true só quando a pessoa confirma; Escape e Cancelar resolvem false. */
export function usePanelConfirm(): PanelConfirmRequest {
  const requestConfirm = useContext(PanelConfirmContext);
  if (!requestConfirm) throw new Error("usePanelConfirm deve ser usado dentro de PanelPromptProvider.");
  return requestConfirm;
}
