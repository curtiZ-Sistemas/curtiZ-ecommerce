export const returnStatusLabels: Record<string, string> = {
  requested: "Solicitação recebida", in_review: "Em análise", waiting_photos: "Aguardando informações",
  approved: "Devolução autorizada", rejected: "Solicitação não aprovada", waiting_posting: "Aguardando postagem",
  in_transit: "Produto a caminho da loja", received: "Recebido pela loja", inspection: "Em conferência",
  exchange_sent: "Troca enviada", refund_requested: "Reembolso em processamento", refunded: "Reembolso confirmado",
  completed: "Concluída", cancelled: "Cancelada"
};

export const returnKindLabels = { withdrawal: "Arrependimento da compra", defect: "Defeito ou produto incorreto", preference: "Troca de tamanho, cor ou modelo" };
export type ReturnKind = keyof typeof returnKindLabels;
export const returnPhotoLimit = 3;
export const returnPhotoMaximumBytes = 5 * 1024 * 1024;
export const returnPolicySummary = "Compras online: comunique o arrependimento em até 7 dias corridos após o recebimento, sem precisar justificar. A devolução é gratuita e o reembolso da compra integral inclui o frete pago. Para defeitos aparentes em calçados, o prazo para reclamar é de 90 dias; defeitos ocultos contam da descoberta. Trocas por preferência fora do arrependimento dependem de avaliação e da política informada na compra.";

export function validateReturnPhotos(files: readonly Pick<File, "size" | "type">[], existing = 0): string {
  if (files.length + existing > returnPhotoLimit) return "Envie no máximo 3 fotos por solicitação.";
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > returnPhotoMaximumBytes))
    return "Envie fotos JPG, PNG ou WebP com até 5 MB cada.";
  return "";
}
