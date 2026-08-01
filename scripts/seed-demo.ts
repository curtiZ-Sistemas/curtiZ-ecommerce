import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "production") {
  throw new Error("O seed de demonstração é bloqueado em produção.");
}

type DemoUser = {
  email: string;
  fullName: string;
  role: "customer" | "representative" | "operational" | "admin" | "manager" | "technical";
  roles?: Array<"customer" | "representative" | "operational" | "admin" | "manager" | "technical">;
};

type AdminUser = {
  id: string;
  email?: string;
};

const users: DemoUser[] = [
  { email: "cliente.demo@curtiz.local", fullName: "Cliente Demo", role: "customer" },
  {
    email: "representante.demo@curtiz.local",
    fullName: "Representante Demo",
    role: "representative",
    roles: ["customer", "representative"]
  },
  { email: "operacional.demo@curtiz.local", fullName: "Operacional Demo", role: "operational" },
  { email: "admin.demo@curtiz.local", fullName: "Administrador Demo", role: "admin" },
  { email: "gerencia.demo@curtiz.local", fullName: "Gerência Demo", role: "manager" },
  { email: "tecnico.demo@curtiz.local", fullName: "Técnico Demo", role: "technical" }
];

function readLocalEnvironment() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match?.[1] || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2]?.replace(/^["']|["']$/gu, "") ?? "";
  }
}

function readSupabaseStatus(): Record<string, string> {
  const cli = resolve("node_modules", "supabase", "dist", "supabase.js");
  if (!existsSync(cli)) return {};

  try {
    const output = execFileSync(process.execPath, [cli, "status", "-o", "env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000
    });
    const variables: Record<string, string> = {};
    for (const line of output.split(/\r?\n/u)) {
      const match = /^([A-Z_]+)=["']?(.*?)["']?$/u.exec(line.trim());
      const name = match?.[1];
      const value = match?.[2];
      if (name && value !== undefined) variables[name] = value;
    }
    return variables;
  } catch {
    return {};
  }
}

async function request<T>(
  url: string,
  serviceKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    throw new Error(`O Supabase recusou uma operação do seed (HTTP ${response.status}).`);
  }
  const body = await response.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

async function main() {
  readLocalEnvironment();
  const localStatus = readSupabaseStatus();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? localStatus.API_URL ?? "http://127.0.0.1:54321";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    localStatus.SERVICE_ROLE_KEY;
  const password = process.env.DEMO_USERS_PASSWORD ?? randomBytes(18).toString("base64url");

  if (!serviceKey) {
    throw new Error(
      "Inicie o Supabase local ou configure uma service key somente no ambiente do seed."
    );
  }

  const existing = await request<{ users: AdminUser[] }>(
    supabaseUrl,
    serviceKey,
    "/auth/v1/admin/users?per_page=1000"
  );

  for (const demoUser of users) {
    const found = existing.users.find((user) => user.email?.toLowerCase() === demoUser.email);
    const authUser = found
      ? await request<AdminUser>(supabaseUrl, serviceKey, `/auth/v1/admin/users/${found.id}`, {
          method: "PUT",
          body: JSON.stringify({
            password,
            email_confirm: true,
            app_metadata: { role: demoUser.role },
            user_metadata: { full_name: demoUser.fullName, is_demo: true }
          })
        })
      : await request<AdminUser>(supabaseUrl, serviceKey, "/auth/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({
            email: demoUser.email,
            password,
            email_confirm: true,
            app_metadata: { role: demoUser.role },
            user_metadata: { full_name: demoUser.fullName, is_demo: true }
          })
        });

    await request<void>(
      supabaseUrl,
      serviceKey,
      `/rest/v1/user_roles?user_id=eq.${encodeURIComponent(authUser.id)}`,
      { method: "DELETE", headers: { prefer: "return=minimal" } }
    );
    await request<void>(supabaseUrl, serviceKey, "/rest/v1/user_roles", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(
        (demoUser.roles ?? [demoUser.role]).map((role) => ({ user_id: authUser.id, role }))
      )
    });
    await request<void>(
      supabaseUrl,
      serviceKey,
      `/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}`,
      {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          full_name: demoUser.fullName,
          is_demo: true,
          status: "active"
        })
      }
    );
  }

  console.log(`${users.length} contas demo foram criadas ou atualizadas com sucesso.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha inesperada ao criar contas demo.");
  process.exitCode = 1;
});
