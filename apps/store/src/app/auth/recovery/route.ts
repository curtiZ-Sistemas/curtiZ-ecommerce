import { type NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const suppliedNonce = request.headers.get("x-nonce") ?? "";
  const nonce = /^[a-f0-9]{32}$/u.test(suppliedNonce) ? suppliedNonce : crypto.randomUUID().replaceAll("-", "");
  // Standalone document: no store analytics, external scripts or token-consuming GET.
  const script = `(async () => {
    const hash = new URLSearchParams(location.hash.slice(1)).get("token_hash");
    history.replaceState(null, "", "/auth/recovery");
    const status = document.getElementById("status");
    const fail = () => { status.textContent = "Não foi possível validar este link. Solicite um novo para continuar."; document.getElementById("retry").hidden = false; };
    if (!hash || !/^[a-zA-Z0-9_-]{32,256}$/.test(hash)) { fail(); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/auth/recovery/verify", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenHash: hash }),
        cache: "no-store", signal: controller.signal });
      if (response.ok) { location.replace("/redefinir-senha"); return; }
      if (response.status === 403) { const result = await response.json(); if (result.redirectTo === "/login?reason=google_account") { location.replace(result.redirectTo); return; } }
      fail();
    } catch { fail(); } finally { clearTimeout(timeout); }
  })();`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Recuperação de acesso · curti Z</title><style nonce="${nonce}">body{margin:0;padding:24px;background:#eee;color:#242424;font:16px/1.6 Arial,sans-serif}main{box-sizing:border-box;max-width:520px;margin:40px auto;padding:28px;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}h1{font-size:26px;color:#62130f}a{color:#62130f}</style></head>
<body><main><img src="/images/logo-curtiz.png" width="140" height="93" alt="curti Z"><h1>Recuperação de acesso</h1>
<p id="status" role="status">Validando seu link com segurança…</p><a id="retry" href="/esqueci-senha" hidden>Solicitar novo link</a>
<noscript>Ative o JavaScript para validar seu link de recuperação.</noscript></main><script nonce="${nonce}">${script}</script></body></html>`;
  return new NextResponse(html, { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
  } });
}
