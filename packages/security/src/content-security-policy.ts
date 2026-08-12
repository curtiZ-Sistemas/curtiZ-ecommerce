export type ContentSecurityPolicyOptions = {
  nonce: string;
  connectSources?: readonly string[];
  frameSources?: readonly string[];
  imageSources?: readonly string[];
  scriptSources?: readonly string[];
  development?: boolean;
};

const sources = (values: readonly string[]) => [...new Set(values)].join(" ");

export const buildNonceContentSecurityPolicy = ({
  nonce,
  connectSources = [],
  frameSources = [],
  imageSources = [],
  scriptSources = [],
  development = false
}: ContentSecurityPolicyOptions): string => {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(nonce)) throw new Error("Invalid CSP nonce");
  return [
    "default-src 'self'",
    `img-src ${sources(["'self'", "data:", "blob:", ...imageSources])}`,
    `style-src ${sources([
      "'self'",
      development ? "'unsafe-inline'" : `'nonce-${nonce}'`
    ])}`,
    "style-src-attr 'unsafe-inline'",
    `script-src ${sources([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
      ...scriptSources
    ])}`,
    `connect-src ${sources(["'self'", ...connectSources])}`,
    frameSources.length ? `frame-src ${sources(frameSources)}` : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
};
