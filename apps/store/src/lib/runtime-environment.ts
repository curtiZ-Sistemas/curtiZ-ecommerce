import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function mergeCloudflareRuntimeBindings(
  buildEnvironment: RuntimeEnvironment,
  bindings: Readonly<Record<string, unknown>>
): RuntimeEnvironment {
  const runtimeValues = Object.fromEntries(
    Object.entries(bindings).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
  return { ...buildEnvironment, ...runtimeValues };
}

export function getStoreRuntimeEnvironment(): RuntimeEnvironment {
  try {
    const { env } = getCloudflareContext();
    return mergeCloudflareRuntimeBindings(process.env, env as unknown as Readonly<Record<string, unknown>>);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") return process.env;
    throw error;
  }
}
