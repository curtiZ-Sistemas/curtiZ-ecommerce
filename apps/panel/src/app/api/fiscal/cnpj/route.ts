import { type NextRequest, NextResponse } from "next/server";
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

/**
 * Preenche razão social e endereço da empresa pelo CNPJ (BrasilAPI, dado público da Receita).
 * Só para quem pode emitir nota de atacado. Se a consulta falhar, a tela segue com preenchimento manual.
 */
export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const auth = db ? await db.auth.getUser() : null;
  if (!db || !auth || auth.error || !auth.data.user || !await hasRequiredInternalMfa(db)) return send({ message: "Acesso negado." }, 403);
  const allowed = await db.rpc("has_permission", { permission_code: "fiscal.wholesale_invoices.issue" });
  if (allowed.error || allowed.data !== true) return send({ message: "Acesso negado." }, 403);

  const cnpj = onlyDigits(request.nextUrl.searchParams.get("cnpj") ?? "");
  if (!/^\d{14}$/u.test(cnpj) || !isValidCnpj(cnpj)) return send({ message: "O CNPJ informado não é válido." }, 400);
  // Host fixo; o caminho recebe só os 14 dígitos já validados.
  const target = new URL("https://brasilapi.com.br/");
  target.pathname = `/api/cnpj/v1/${encodeURIComponent(cnpj)}`;
  try {
    const response = await fetch(target, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000), redirect: "error"
    });
    if (response.status === 404) return send({ found: false, message: "CNPJ não encontrado na Receita." });
    const data = record(response.ok ? await response.json() : null);
    if (!data) return send({ message: manual }, 502);
    const street = [text(data.descricao_tipo_de_logradouro), text(data.logradouro)].filter(Boolean).join(" ");
    return send({
      found: true, name: text(data.razao_social), status: title(text(data.descricao_situacao_cadastral)),
      active: text(data.descricao_situacao_cadastral).toUpperCase() === "ATIVA",
      address: {
        state: text(data.uf).toUpperCase(), postal_code: onlyDigits(text(data.cep)).slice(0, 8), street: title(street),
        number: text(data.numero), complement: title(text(data.complemento)), district: title(text(data.bairro)), city: title(text(data.municipio))
      }
    });
  } catch {
    return send({ message: manual }, 502);
  }
}
