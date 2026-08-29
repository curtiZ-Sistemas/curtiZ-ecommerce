"use client";

import React, { createContext, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

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

type PendingPrompt = PanelPromptOptions & { resolve: (value: string | null) => void };
type PanelPromptRequest = (options: PanelPromptOptions) => Promise<string | null>;

const PanelPromptContext = createContext<PanelPromptRequest | null>(null);

export function PanelPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState("");
  const resolverRef = useRef<PendingPrompt["resolve"] | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const close = useCallback((result: string | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setPending(null);
    setValue("");
  }, []);

  const requestPrompt = useCallback<PanelPromptRequest>((options) => {
    resolverRef.current?.(null);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setValue(options.defaultValue ?? "");
      setPending({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
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
    };
  }, [close, pending]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (normalized.length < (pending?.minLength ?? 1)) return;
    close(normalized);
  };

  return (
    <PanelPromptContext.Provider value={requestPrompt}>
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
    </PanelPromptContext.Provider>
  );
}

export function usePanelPrompt(): PanelPromptRequest {
  const requestPrompt = useContext(PanelPromptContext);
  if (!requestPrompt) throw new Error("usePanelPrompt deve ser usado dentro de PanelPromptProvider.");
  return requestPrompt;
}
