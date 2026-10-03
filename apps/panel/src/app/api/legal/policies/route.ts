import { legalPolicies } from "@curtiz/domain";
import { readJsonResponse } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  objectRows,
  privateNoStore,
  safePanelOrigin,
  unauthorizedAdminResponse
} from "@/lib/admin-api";
import { authorizeLegalRequest, legalPermissions } from "@/lib/legal-api";

const section = z
  .object({
    section_number: z.string().regex(/^\d+(?:\.\d+)*$/u),
    title: z.string().trim().min(2).max(180),
    content: z.string().min(1).max(30000),
    content_format: z.enum(["plain", "markdown"]),
    sort_order: z.number().int().min(0).max(1000)
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("import"),
      slug: z.enum(legalPolicies.map((policy) => policy.slug)),
      title: z.string().trim().min(3).max(180),
      sections: z.array(section).min(1).max(80),
      expectedUpdatedAt: z.string().datetime({ offset: true }).nullable()
    })
    .strict(),
  z
    .object({
      action: z.literal("publish"),
      documents: z
        .array(
          z
            .object({ id: z.string().uuid(), updated_at: z.string().datetime({ offset: true }) })
            .strict()
        )
        .min(1)
        .max(8)
    })
    .strict()
]);
function legalOperationError(error: unknown) {
  const detail =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  if (detail.includes("concurrent"))
    return "Documento alterado por outra pessoa. Atualize a tela e confira a nova versão.";
  if (detail.includes("destination"))
    return "O destino da política não corresponde ao cadastro existente.";
  if (detail.includes("permission") || detail.includes("denied"))
    return "Você não tem permissão para esta ação.";
  if (detail.includes("not found")) return "Documento não encontrado. Atualize a tela.";
  return "Não foi possível salvar ou publicar. Tente novamente; se persistir, procure o responsável pelo sistema.";
}
async function getPolicies(request: NextRequest) {
  const auth = await authorizeLegalRequest(request, "legal_content.view");
  if (!auth) return unauthorizedAdminResponse(request);
  const [documents, sections, company, permissions] = await Promise.all([
    auth.supabase.from("legal_documents").select("*").order("public_title"),
    auth.supabase.from("legal_document_sections").select("*").order("sort_order"),
    auth.supabase.from("company_legal_information").select("*").eq("id", true).maybeSingle(),
    Promise.all(
      legalPermissions.map(async (permission) => {
        const result = await auth.supabase.rpc("has_legal_permission", {
          p_permission: permission
        });
        return [permission, !result.error && result.data === true] as const;
      })
    )
  ]);
  if (documents.error || sections.error || company.error)
    return NextResponse.json(
      { message: "Não foi possível carregar as políticas. Tente novamente." },
      { status: 503, headers: privateNoStore }
    );
  return NextResponse.json(
    {
      documents: objectRows(documents.data),
      sections: objectRows(sections.data),
      company: objectRows([company.data])[0] ?? null,
      capabilities: Object.fromEntries(permissions)
    },
    { headers: privateNoStore }
  );
}
async function postPolicies(request: NextRequest) {
  if (!safePanelOrigin(request))
    return NextResponse.json(
      { message: "Origem não permitida." },
      { status: 403, headers: privateNoStore }
    );
  const body = await readJsonResponse(request, 300000);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { message: "Revise o destino e o conteúdo enviado." },
      { status: 400, headers: privateNoStore }
    );
  const data = parsed.data;
  const auth = await authorizeLegalRequest(
    request,
    data.action === "import" ? "legal_content.edit" : "legal_content.publish"
  );
  if (!auth) return unauthorizedAdminResponse(request);
  if (data.action === "import") {
    const result = await auth.supabase.rpc("import_legal_policy", {
      p_slug: data.slug,
      p_title: data.title,
      p_sections: data.sections,
      p_expected_updated_at: data.expectedUpdatedAt
    });
    if (result.error)
      return NextResponse.json(
        { message: legalOperationError(result.error) },
        { status: 409, headers: privateNoStore }
      );
    return NextResponse.json(
      { result: objectRows([result.data])[0] ?? null, message: "Minuta salva no destino correto." },
      { headers: privateNoStore }
    );
  }
  if (new Set(data.documents.map((document) => document.id)).size !== data.documents.length)
    return NextResponse.json(
      { message: "O lote contém documentos repetidos." },
      { status: 400, headers: privateNoStore }
    );
  const validation = await auth.supabase.rpc("validate_legal_policy_publication", {
    p_documents: data.documents
  });
  if (validation.error)
    return NextResponse.json(
      { message: legalOperationError(validation.error) },
      { status: 409, headers: privateNoStore }
    );
  const preview = objectRows(validation.data);
  const results: Record<string, unknown>[] = [];
  for (const document of data.documents) {
    const check = preview.find((item) => item.id === document.id);
    if (!check || !Array.isArray(check.problems) || check.problems.length) {
      results.push({
        id: document.id,
        published: false,
        problems: check?.problems ?? ["Validação indisponível."]
      });
      continue;
    }
    try {
      const publication = await auth.supabase.rpc("publish_legal_policy", {
        p_id: document.id,
        p_expected_updated_at: document.updated_at
      });
      const result = objectRows([publication.data])[0];
      results.push(
        publication.error
          ? {
              id: document.id,
              published: false,
              problems: [legalOperationError(publication.error)]
            }
          : {
              ...result,
              id: document.id,
              published: Boolean(result && !result.problems),
              problems: result?.problems ?? []
            }
      );
    } catch (error) {
      results.push({ id: document.id, published: false, problems: [legalOperationError(error)] });
    }
  }
  return NextResponse.json({ results }, { headers: privateNoStore });
}

export async function GET(request: NextRequest) {
  try {
    return await getPolicies(request);
  } catch {
    return NextResponse.json(
      { message: "Não foi possível carregar as políticas. Tente novamente." },
      { status: 503, headers: privateNoStore }
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    return await postPolicies(request);
  } catch {
    return NextResponse.json(
      {
        message: "Não foi possível concluir a operação. Atualize a tela antes de tentar novamente."
      },
      { status: 503, headers: privateNoStore }
    );
  }
}
