import { createHash, randomUUID } from "node:crypto";
import { DEMO_SESSION_COOKIE, verifyDemoSession } from "@curtiz/security";
import { type NextRequest, NextResponse } from "next/server";
import { isAllowedRequestOrigin } from "@/lib/http-origin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUnknownRecord, readQueryResult, readString } from "@/lib/unknown-data";
import { inspectUpload, type AcceptedUploadMime } from "@/lib/file-validation";

const allowedTypes = new Set<AcceptedUploadMime>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);
const allowedDocumentTypes = new Set(["identity_front", "address_proof", "commercial_support"]);
const maximumBytes = 10 * 1024 * 1024;
const multipartOverheadBytes = 512 * 1024;
const noStore = { "cache-control": "private, no-store" };

const cleanName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/gu, "-")
    .slice(-120) || "documento";

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes + multipartOverheadBytes) {
    return NextResponse.json(
      { message: "Documento acima do limite de 10 MB." },
      { status: 413, headers: noStore }
    );
  }
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "Origem não autorizada." },
      { status: 403, headers: noStore }
    );
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const documentType = form?.get("documentType");
  if (
    !(file instanceof File) ||
    typeof documentType !== "string" ||
    !allowedDocumentTypes.has(documentType)
  ) {
    return NextResponse.json({ message: "Documento inválido." }, { status: 400, headers: noStore });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectUpload(bytes, file.type, allowedTypes);
  if (!inspected) {
    return NextResponse.json(
      { message: "O conteúdo do documento não corresponde ao formato informado." },
      { status: 422, headers: noStore }
    );
  }
  if (
    !allowedTypes.has(file.type as AcceptedUploadMime) ||
    file.size < 1 ||
    file.size > maximumBytes
  ) {
    return NextResponse.json(
      { message: "Envie PDF, JPG, PNG ou WebP com até 10 MB." },
      { status: 422, headers: noStore }
    );
  }

  const demoSession =
    process.env.DEMO_MODE === "true"
      ? verifyDemoSession(request.cookies.get(DEMO_SESSION_COOKIE)?.value)
      : null;
  if (demoSession) {
    if (!demoSession.roles.includes("customer")) {
      return NextResponse.json({ message: "Acesso negado." }, { status: 403, headers: noStore });
    }
    return NextResponse.json(
      { id: randomUUID(), documentType, name: cleanName(file.name), size: file.size, demo: true },
      { status: 201, headers: noStore }
    );
  }

  const supabase = await createServerSupabaseClient();
  const userResult = supabase ? await supabase.auth.getUser() : null;
  const user = userResult?.data.user;
  if (!supabase || !user) {
    return NextResponse.json(
      { message: "Entre para continuar." },
      { status: 401, headers: noStore }
    );
  }
  const applicationResponse: unknown = await supabase
    .from("representative_applications")
    .select("id,status")
    .eq("user_id", user.id)
    .maybeSingle();
  const applicationData = readQueryResult(applicationResponse).data;
  const application = isUnknownRecord(applicationData) ? applicationData : null;
  const applicationStatus = application ? readString(application, "status") : "";
  if (!application || !["draft", "documents_pending"].includes(applicationStatus)) {
    return NextResponse.json(
      { message: "A solicitação não aceita novos documentos." },
      { status: 409, headers: noStore }
    );
  }

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const applicationId = readString(application, "id");
  if (!applicationId) {
    return NextResponse.json({ message: "Solicitação inválida." }, { status: 409, headers: noStore });
  }
  const path = `${user.id}/${applicationId}/${randomUUID()}-${cleanName(file.name)}`;
  const upload = await supabase.storage
    .from("representative-documents")
    .upload(path, bytes, { contentType: inspected.mime, upsert: false });
  if (upload.error) {
    return NextResponse.json(
      { message: "Não foi possível armazenar o documento." },
      { status: 503, headers: noStore }
    );
  }

  const inserted = await supabase
    .from("representative_application_documents")
    .insert({
      application_id: applicationId,
      document_type: documentType.trim().slice(0, 80),
      storage_path: path,
      original_name: cleanName(file.name),
      mime_type: inspected.mime,
      size_bytes: file.size,
      checksum_sha256: checksum,
      uploaded_by: user.id
    })
    .select("id,document_type,status,created_at")
    .single();
  if (inserted.error) {
    await supabase.storage.from("representative-documents").remove([path]);
    return NextResponse.json(
      { message: "Não foi possível vincular o documento à solicitação." },
      { status: 409, headers: noStore }
    );
  }
  return NextResponse.json(inserted.data, { status: 201, headers: noStore });
}
