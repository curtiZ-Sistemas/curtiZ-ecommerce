export function loadTarget() {
  const raw = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/u, "");
  const target = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  const stagingHost = /(^|[.-])(staging|stage|preview|test|dev)([.-]|$)/iu.test(target.hostname);

  if (!local && (__ENV.TARGET_ENV !== "staging" || __ENV.ALLOW_STAGING !== "true" || !stagingHost)) {
    throw new Error(
      "Teste de carga recusado. Use localhost ou um host explícito de staging com TARGET_ENV=staging e ALLOW_STAGING=true."
    );
  }

  return raw;
}
