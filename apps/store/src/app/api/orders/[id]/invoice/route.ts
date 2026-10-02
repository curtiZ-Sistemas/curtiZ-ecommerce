import { NextResponse } from "next/server";
import { createBlingClient } from "@curtiz/integrations";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readString } from "@/lib/unknown-data";

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const reply = (message: string, status: number) => NextResponse.json({ message }, { status, headers });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) return reply("Pedido inválido.", 400);
  const auth = await createServerSupabaseClient();
  const session = auth ? await auth.auth.getUser() : null;
  if (!auth || session?.error || !session?.data.user) return reply("Entre na sua conta para consultar a nota.", 401);
  const document = await auth.rpc("read_my_bling_invoice_document", { p_order_id: id });
  if (document.error) return reply("Consulta indisponível. Tente novamente.", 503);
  if (!isUnknownRecord(document.data)) return reply("Nota ainda não disponível.", 404);
  const key = readString(document.data, "accessKey");
  const db = createServiceSupabaseClient();
  if (!db) return reply("Documento indisponível. Tente novamente.", 503);
  try {
    const provider = createBlingClient(process.env, async (name, args) => db.rpc(name, args));
    const invoiceId = Number(document.data.invoiceId);
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return reply("Nota ainda não disponível.", 404);
    const result = await provider.request(`/nfe/${invoiceId}`);
    const invoice = isUnknownRecord(result) && isUnknownRecord(result.data) ? result.data : null;
    if (!invoice || ![5, 6].includes(Number(invoice.situacao)) || readString(invoice, "chaveAcesso") !== key)
      return reply("Nota ainda não disponível.", 404);
    const pdf = await provider.invoiceDocument(key);
    return new NextResponse(pdf, { headers: { ...headers, "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="nota-fiscal.pdf"' } });
  } catch { return reply("Não foi possível baixar a nota agora. Tente novamente.", 503); }
}
