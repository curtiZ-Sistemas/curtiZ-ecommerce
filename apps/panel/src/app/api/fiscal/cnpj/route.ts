import { type NextRequest, NextResponse } from "next/server";
import { logServerEvent } from "@curtiz/security";
import { isValidCnpj, onlyDigits } from "@/lib/cnpj";
import { hasRequiredInternalMfa } from "@/lib/internal-mfa";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { technicalNoStore } from "@/lib/technical-api";

const send = (value: object, status = 200) => NextResponse.json(value, { status, headers: technicalNoStore });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const title = (value: string) => value.toLowerCase().replace(/(^|\s)\S/gu, letter => letter.toUpperCase());
const manual = "A consulta do CNPJ está indisponível. Preencha os dados manualmente.";

type Company = { found: true; name: string; status: string; active: boolean; registration?: string;
  address: { state: string; postal_code: string; street: string; number: string; complement: string; district: string; city: string } };

function company(name: string, status: string, address: Company["address"], registration?: string): Company | null {
  if (!name || !/^[A-Z]{2}$/u.test(address.state) || !/^\d{8}$/u.test(address.postal_code) || !address.city || !address.street) return null;
  return { found: true, name, status: title(status), active: status.toUpperCase() === "ATIVA",
    ...(registration ? { registration } : {}), address };
}

function nestedCompany(data: Record<string, unknown>, cnpj: string): Company | null {
  const e = record(data.estabelecimento);
  if (!e || onlyDigits(text(e.cnpj)) !== cnpj) return null;
  const state = text(record(e.estado)?.sigla).toUpperCase();
  const status = text(e.situacao_cadastral);
  const registrations = Array.isArray(e.inscricoes_estaduais) ? e.inscricoes_estaduais.map(record) : [];
  const activeMg = [...new Set(registrations.filter(ie => ie?.ativo === true && text(record(ie.estado)?.sigla) === "MG")
    .map(ie => onlyDigits(text(ie?.inscricao_estadual))).filter(ie => /^\d{13}$/u.test(ie)))];
  return company(text(data.razao_social), status, {
    state, postal_code: onlyDigits(text(e.cep)), street: title([text(e.tipo_logradouro), text(e.logradouro)].filter(Boolean).join(" ")),
    number: text(e.numero), complement: title(text(e.complemento)), district: title(text(e.bairro)), city: title(text(record(e.cidade)?.nome))
  }, status.toUpperCase() === "ATIVA" && state === "MG" && activeMg.length === 1 ? activeMg[0] : undefined);
}

function brasilCompany(data: Record<string, unknown>, cnpj: string): Company | null {
  if (data.cnpj !== undefined && onlyDigits(text(data.cnpj)) !== cnpj) return null;
  return company(text(data.razao_social), text(data.descricao_situacao_cadastral), {
    state: text(data.uf).toUpperCase(), postal_code: onlyDigits(text(data.cep)),
    street: title([text(data.descricao_tipo_de_logradouro), text(data.logradouro)].filter(Boolean).join(" ")),
    number: text(data.numero), complement: title(text(data.complemento)), district: title(text(data.bairro)), city: title(text(data.municipio))
  });
}

function receitaCompany(data: Record<string, unknown>, cnpj: string): Company | null {
  if (text(data.status) !== "OK" || onlyDigits(text(data.cnpj)) !== cnpj) return null;
  return company(text(data.nome), text(data.situacao), {
    state: text(data.uf).toUpperCase(), postal_code: onlyDigits(text(data.cep)), street: title(text(data.logradouro)),
    number: text(data.numero), complement: title(text(data.complemento)), district: title(text(data.bairro)), city: title(text(data.municipio))
  });
}

type Provider = { name: string; url: string; parse: (data: Record<string, unknown>, cnpj: string) => Company | null };

async function lookup(provider: Provider, cnpj: string) {
  try {
    const response = await fetch(new URL(provider.url + encodeURIComponent(cnpj)), {
      headers: { accept: "application/json", "user-agent": "CurtiZ-CNPJ/1.0" },
      cache: "no-store", signal: AbortSignal.timeout(4500), redirect: "error"
    });
    if (!response.ok) return { data: null, status: response.status };
    const payload = record(await response.json());
    const data = payload ? provider.parse(payload, cnpj) : null;
    return { data, status: data ? 200 : "invalid_response" };
  } catch {
    return { data: null, status: "transport_or_timeout" };
  }
}

/** Consulta apenas dados públicos da empresa, protegida pela permissão fiscal e MFA. */
export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth || auth.error || !auth.data.user || !await hasRequiredInternalMfa(db)) return send({ message: "Acesso negado." }, 403);
  const allowed = await db.rpc("has_permission", { permission_code: "fiscal.wholesale_invoices.issue" });
  if (allowed.error || allowed.data !== true) return send({ message: "Acesso negado." }, 403);

  const cnpj = onlyDigits(request.nextUrl.searchParams.get("cnpj") ?? "");
  if (!/^\d{14}$/u.test(cnpj) || !isValidCnpj(cnpj)) return send({ message: "O CNPJ informado não é válido." }, 400);
  // Hosts fixos, sem envio de cookies, tokens, dados do operador ou dados da nota.
  const providers: Provider[] = [
    { name: "cnpj_ws", url: "https://publica.cnpj.ws/cnpj/", parse: nestedCompany },
    { name: "brasil_api", url: "https://brasilapi.com.br/api/cnpj/v1/", parse: brasilCompany },
    { name: "open_cnpj", url: "https://api.opencnpj.com.br/cnpj/", parse: nestedCompany },
    { name: "receita_ws", url: "https://www.receitaws.com.br/v1/cnpj/", parse: receitaCompany }
  ];
  const attempts: { provider: string; status: number | string }[] = [];
  for (const provider of providers) {
    const result = await lookup(provider, cnpj);
    attempts.push({ provider: provider.name, status: result.status });
    if (result.data) {
      if (attempts.length > 1) logServerEvent("info", "wholesale_cnpj_fallback_success", { attempts });
      return send(result.data);
    }
  }
  // Não transformar indisponibilidade, rate limit ou resposta inválida em CNPJ inexistente.
  logServerEvent("warn", "wholesale_cnpj_lookup_failed", { attempts });
  if (attempts.every(attempt => attempt.status === 404)) return send({ found: false, message: "CNPJ não encontrado nas bases consultadas." });
  return send({ found: false, unavailable: true, message: manual });
}
