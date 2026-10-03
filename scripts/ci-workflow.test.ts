import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment-validation";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8").replaceAll("\r\n", "\n");

const stepBlock = (name: string): string => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`Passo não encontrado: ${name}`);
  const next = workflow.slice(start + 1).search(/\n {6}- |\n {2}[a-z-]+:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

const deployVarNames = (block: string): string[] => {
  const match = /for name in ([\s\S]*?); do/.exec(block);
  if (!match?.[1]) throw new Error("Lista de variáveis de deploy não encontrada");
  return match[1].replaceAll("\\", " ").split(/\s+/).filter(Boolean);
};

const topLevelEnv = (): Record<string, string> => {
  const section = /\nenv:\n([\s\S]*?)\njobs:/u.exec(workflow)?.[1] ?? "";
  return Object.fromEntries(
    section.split("\n").filter((line) => /^ {2}[A-Z_]+: /u.test(line)).map((line) => {
      const [name, ...value] = line.trim().split(": ");
      return [name ?? "", value.join(": ").replaceAll("\"", "")];
    })
  );
};

const platformVars = [
  "GIT_COMMIT_SHA", "BUILD_ID", "BUILD_TIMESTAMP", "APP_ENV", "PANEL_DEPLOYMENT_MODE", "DEMO_MODE",
  "ALLOWED_ORIGINS", "AUTH_COOKIE_DOMAINS", "NEXT_PUBLIC_STORE_URL", "NEXT_PUBLIC_PANEL_URL",
  "NEXT_PUBLIC_STORE_TEST_URL", "NEXT_PUBLIC_PANEL_TEST_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"
];

const deploySteps = {
  store: { step: "Publicar curtiz-ecommerce", allowed: [...platformVars, "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY"] },
  panel: { step: "Publicar curtiz-painel", allowed: platformVars }
};

// Configurações administradas somente no Runtime do Cloudflare.
const runtimeOwned = /^(CHECKOUT_ENABLED|PAYMENT_PROVIDER|MERCADO_PAGO_(?!.*PUBLIC_KEY).*|SHIPPING_PROVIDER|MELHOR_ENVIO_.*|EMAIL_.*|TURNSTILE_ENABLED|REQUIRE_INTERNAL_MFA|AUTH_RATE_LIMIT_ENABLED)$/;

describe("workflow de deploy (.github/workflows/ci.yml)", () => {
  it("mantém o E2E local com cookies de host e sem herdar aliases de produção", () => {
    const job = workflow.split("  e2e:\n")[1]?.split("    steps:\n")[0] ?? "";
    const overrides = Object.fromEntries(
      [...job.matchAll(/^ {6}([A-Z_]+): (.*)$/gmu)].map((match) => [
        match[1] ?? "", (match[2] ?? "").replaceAll('"', "")
      ])
    );
    expect(overrides).toMatchObject({
      APP_ENV: "development", AUTH_COOKIE_DOMAINS: "",
      NEXT_PUBLIC_STORE_TEST_URL: "", NEXT_PUBLIC_PANEL_TEST_URL: "",
      ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:3001"
    });
    expect(validateEnvironment("development", { ...topLevelEnv(), ...overrides }))
      .toMatchObject({ valid: true, errors: [] });
  });

  it("valida URLs reais, origens e cookies versionados para os dois Workers", () => {
    const environment = topLevelEnv();
    expect(environment).toMatchObject({
      NEXT_PUBLIC_STORE_URL: "https://curtiz.com.br",
      NEXT_PUBLIC_PANEL_URL: "https://painel.curtiz.com.br",
      NEXT_PUBLIC_STORE_TEST_URL: "https://curtiz-ecommerce.sistemas-curtiz.workers.dev",
      NEXT_PUBLIC_PANEL_TEST_URL: "https://curtiz-painel.sistemas-curtiz.workers.dev",
      AUTH_COOKIE_DOMAINS: "curtiz.com.br,sistemas-curtiz.workers.dev"
    });
    expect(new Set(environment.ALLOWED_ORIGINS?.split(","))).toEqual(new Set([
      environment.NEXT_PUBLIC_STORE_URL, environment.NEXT_PUBLIC_PANEL_URL,
      environment.NEXT_PUBLIC_STORE_TEST_URL, environment.NEXT_PUBLIC_PANEL_TEST_URL
    ]));
    for (const target of ["store", "panel"]) {
      expect(validateEnvironment("production", {
        ...environment, DEPLOY_TARGET: target,
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "ci-publishable-placeholder",
        SUPABASE_SECRET_KEY: "ci-secret-placeholder",
        ACCOUNT_DELETION_HMAC_KEY: "ci-account-deletion-key-with-at-least-32-characters",
        PII_ENCRYPTION_KEY: "ci-pii-placeholder", AUDIT_HASH_KEY: "ci-audit-placeholder",
        RATE_LIMIT_HMAC_KEY: "ci-rate-limit-placeholder-with-32-characters",
        REFERRAL_ATTRIBUTION_HMAC_KEY: "ci-referral-placeholder-with-32-characters"
      })).toMatchObject({ valid: true, errors: [] });
      const job = workflow.split(`  ${target}-worker:\n`)[1]?.split(/\n {2}[a-z-]+:\n/)[0] ?? "";
      expect(job).not.toMatch(/vars\.(ALLOWED_ORIGINS|AUTH_COOKIE_DOMAINS|NEXT_PUBLIC_(STORE|PANEL)(_TEST)?_URL)\b/u);
      const config = readFileSync(resolve(process.cwd(), `apps/${target}/wrangler.jsonc`), "utf8");
      const workerName = target === "store" ? "curtiz-ecommerce" : "curtiz-painel";
      expect(config).toContain(`"name": "${workerName}"`);
      const testUrl = target === "store" ? environment.NEXT_PUBLIC_STORE_TEST_URL : environment.NEXT_PUBLIC_PANEL_TEST_URL;
      expect(new URL(testUrl ?? "").hostname).toBe(`${workerName}.sistemas-curtiz.workers.dev`);
    }
  });

  it.each([
    ["Validar empacotamento de produção da loja", "pnpm deploy:dry-run", "Publicar curtiz-ecommerce"],
    ["Validar empacotamento de produção do painel", "pnpm deploy:dry-run:panel", "Publicar curtiz-painel"]
  ])("%s verifica o bundle final inclusive em pull requests", (step, command, deploy) => {
    const block = stepBlock(step);
    expect(block.trimEnd().endsWith(`run: ${command}`)).toBe(true);
    expect(block).not.toContain("if:");
    expect(workflow.indexOf(block)).toBeLessThan(workflow.indexOf(stepBlock(deploy)));
  });

  it.each(Object.entries(deploySteps))("%s publica com --keep-vars", (_, { step }) => {
    expect(stepBlock(step)).toMatch(/wrangler deploy --config apps\/(store|panel)\/wrangler\.jsonc --env production --keep-vars "\$\{deploy_vars\[@\]\}"/);
  });

  it.each(Object.entries(deploySteps))("%s envia somente metadados e configuração de plataforma", (_, { step, allowed }) => {
    const names = deployVarNames(stepBlock(step));
    expect(names).toEqual(allowed);
    expect(names.filter((name) => runtimeOwned.test(name))).toEqual([]);
  });

  it.each(Object.entries(deploySteps))("%s nunca envia --var cru nem valor vazio", (_, { step }) => {
    const block = stepBlock(step);
    expect(block).not.toMatch(/--var "[A-Z_]+:/);
    expect(block).toContain('[[ -n "$value" ]] && deploy_vars+=(--var "$1:${value}")');
  });

  it("não lê configurações de integração, MFA ou rate limit de GitHub vars", () => {
    const githubVars = [...workflow.matchAll(/vars\.([A-Z0-9_]+)/g)].map((match) => match[1] ?? "");
    expect(githubVars.filter((name) => runtimeOwned.test(name))).toEqual([]);
    expect(workflow).not.toMatch(/MELHOR_ENVIO_ORIGIN|CNPJ|CNAE|STATE_REGISTER/);
  });

  it("não move credenciais sensíveis para GitHub vars ou secrets", () => {
    const referenced = [...workflow.matchAll(/\b(?:vars|secrets)\.([A-Z0-9_]+)/g)].map((match) => match[1] ?? "");
    expect(referenced.filter((name) =>
      /CLIENT_SECRET|ENCRYPTION_KEY|ORIGIN_DOCUMENT|COMPANY_DOCUMENT|ACCESS_TOKEN|WEBHOOK_SECRET|RESEND_API_KEY|TURNSTILE_SECRET_KEY/.test(name)
    )).toEqual([]);
    expect(new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1])))
      .toEqual(new Set(["GITLEAKS_LICENSE", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]));
  });

  it("compila com checkout e integrações desativados", () => {
    expect(topLevelEnv()).toMatchObject({
      CHECKOUT_ENABLED: "false",
      PAYMENT_PROVIDER: "disabled",
      MERCADO_PAGO_ENABLED: "false",
      SHIPPING_PROVIDER: "disabled",
      MELHOR_ENVIO_ENABLED: "false"
    });
  });
});

describe("caminho único de produção", () => {
  const workflowsDirectory = resolve(process.cwd(), ".github/workflows");
  const workflows = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/u.test(name));

  it("somente ci.yml publica Workers, e apenas fora de pull requests", () => {
    const deploying = workflows.filter((name) =>
      /wrangler (deploy|versions deploy)|cloudflare\/wrangler-action/u.test(readFileSync(resolve(workflowsDirectory, name), "utf8")));
    expect(deploying).toEqual(["ci.yml"]);
    for (const step of ["Publicar curtiz-ecommerce", "Publicar curtiz-painel"]) {
      expect(stepBlock(step)).toContain("if: github.event_name != 'pull_request'");
    }
  });

  it("deploy do Actions depende de todos os gates", () => {
    expect(workflow.match(/needs: \[changes, quality, database, e2e, security\]/gu)).toHaveLength(2);
  });

  it("documenta que o Workers Builds é configuração remota e precisa ser desconectado manualmente", () => {
    const docs = readFileSync(resolve(process.cwd(), "docs/deployment.md"), "utf8");
    expect(docs).toContain("Workers & Pages** → `curtiz-ecommerce` → **Settings → Builds**");
    expect(docs).toContain("**Disconnect**");
    expect(docs).toContain("Repita em `curtiz-painel`");
    expect(docs).toContain("A conexão Git do Cloudflare é uma configuração **remota**");
  });

  it("os wrangler.jsonc não declaram build remoto nem vars que sobrescrevam o runtime", () => {
    for (const app of ["store", "panel"]) {
      const config = readFileSync(resolve(process.cwd(), `apps/${app}/wrangler.jsonc`), "utf8");
      expect(config).toContain('"keep_vars": true');
      expect(config).not.toMatch(/"vars"\s*:/u);
      expect(config).not.toMatch(/"build"\s*:/u);
    }
  });
});
