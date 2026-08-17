import type { ReactNode } from "react";

export function ErrorPageShell({
  code,
  eyebrow,
  title,
  description,
  actions,
  children
}: {
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="container page-shell error-page">
      <section className="error-recovery" aria-labelledby="error-page-title">
        <span className="error-code">{code}</span>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="error-page-title">{title}</h1>
        <p className="error-description">{description}</p>
        <div className="error-actions">{actions}</div>
      </section>
      {children}
    </div>
  );
}
