export type ContentSecurityPolicyOptions = {
  nonce: string;
  connectSources?: readonly string[];
  frameSources?: readonly string[];
  imageSources?: readonly string[];
  mediaSources?: readonly string[];
  scriptSources?: readonly string[];
  styleSources?: readonly string[];

  /*
   * Alguns SDKs de terceiros, como o Mercado Pago Bricks,
   * criam elementos <style> dinamicamente sem acesso ao nonce
   * gerado pela aplicação.
   *
   * Deve permanecer false por padrão e ser habilitado somente
   * nas rotas que realmente necessitam disso.
   */
  allowUnsafeInlineStyleElements?: boolean;

  development?: boolean;
};

const sources = (values: readonly string[]) =>
  [...new Set(values.filter(Boolean))].join(" ");

export const buildNonceContentSecurityPolicy = ({
  nonce,
  connectSources = [],
  frameSources = [],
  imageSources = [],
  mediaSources = [],
  scriptSources = [],
  styleSources = [],
  allowUnsafeInlineStyleElements = false,
  development = false
}: ContentSecurityPolicyOptions): string => {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }

  /*
   * style-src continua restritivo.
   *
   * style-src-elem é separado para permitir, quando explicitamente
   * solicitado, que SDKs confiáveis criem elementos <style>
   * dinamicamente.
   *
   * Isso evita colocar unsafe-inline no style-src global de todas
   * as páginas da aplicação.
   */
  const styleElementSources = [
    "'self'",
    ...styleSources,
    development || allowUnsafeInlineStyleElements
      ? "'unsafe-inline'"
      : `'nonce-${nonce}'`
  ];

  return [
    "default-src 'self'",

    `img-src ${sources([
      "'self'",
      "data:",
      "blob:",
      ...imageSources
    ])}`,

    `media-src ${sources([
      "'self'",
      "blob:",
      ...mediaSources
    ])}`,

    /*
     * Política base para CSS.
     */
    `style-src ${sources([
      "'self'",
      ...styleSources,
      development
        ? "'unsafe-inline'"
        : `'nonce-${nonce}'`
    ])}`,

    /*
     * Elementos <style>.
     *
     * No checkout do Mercado Pago esta diretiva poderá receber
     * unsafe-inline de maneira explícita e limitada àquela rota.
     */
    `style-src-elem ${sources(styleElementSources)}`,

    /*
     * O projeto já utilizava style attributes inline.
     * Mantemos o comportamento existente.
     */
    "style-src-attr 'unsafe-inline'",

    `script-src ${sources([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development
        ? ["'unsafe-eval'"]
        : []),
      ...scriptSources
    ])}`,

    `connect-src ${sources([
      "'self'",
      ...connectSources
    ])}`,

    frameSources.length
      ? `frame-src ${sources(frameSources)}`
      : "frame-src 'none'",

    "object-src 'none'",

    "base-uri 'self'",

    "form-action 'self'",

    "frame-ancestors 'none'",

    ...(development
      ? []
      : ["upgrade-insecure-requests"])
  ].join("; ");
};