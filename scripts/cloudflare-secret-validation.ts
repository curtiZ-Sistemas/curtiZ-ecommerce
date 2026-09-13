import { appendFileSync, readFileSync } from "node:fs";
import { type EnvironmentValues, requiredDeploymentSecrets } from "./environment-validation";

type SecretEntry = { name?: unknown };

export const requiredCloudflareSecrets = requiredDeploymentSecrets;

export function missingCloudflareSecrets(
  entries: readonly SecretEntry[],
  environment: EnvironmentValues
): string[] {
  const configured = new Set(
    entries.flatMap((entry) =>
      typeof entry.name === "string" && entry.name.trim() ? [entry.name.trim()] : []
    )
  );
  return requiredCloudflareSecrets(environment).filter((name) => !configured.has(name));
}

const placeholderFor = (name: string) => {
  if (name === "MERCADO_PAGO_ACCESS_TOKEN") return "TEST-cloudflare-secret-present";
  if (name === "PII_ENCRYPTION_KEY") return "cloudflare-secret-present-at-runtime";
  return "cloudflare-secret-present";
};

function run() {
  const source = process.argv[2];
  if (!source) {
    console.error("Informe o arquivo JSON produzido por wrangler secret list.");
    process.exitCode = 1;
    return;
  }
  let entries: SecretEntry[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(source, "utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry: unknown) => !entry || typeof entry !== "object" || Array.isArray(entry))
    ) {
      throw new Error("invalid secret list");
    }
    entries = parsed as SecretEntry[];
  } catch {
    console.error("Não foi possível validar a lista de secrets do Worker.");
    process.exitCode = 1;
    return;
  }

  const missing = missingCloudflareSecrets(entries, process.env);
  if (missing.length) {
    console.error(`Secrets obrigatórios ausentes no Worker: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const githubEnvironment = process.env.GITHUB_ENV?.trim();
  if (githubEnvironment) {
    appendFileSync(
      githubEnvironment,
      requiredCloudflareSecrets(process.env)
        .map((name) => `${name}=${placeholderFor(name)}`)
        .join("\n") + "\n",
      "utf8"
    );
  }
  console.log("Presença dos secrets obrigatórios do Worker validada.");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/cloudflare-secret-validation.ts")) run();
