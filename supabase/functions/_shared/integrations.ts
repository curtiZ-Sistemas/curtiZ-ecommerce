const enabled = (value: string | undefined): boolean =>
  ["true", "1", "yes"].includes(value?.trim().toLowerCase() ?? "");

export const isMercadoPagoEnabled = (): boolean => {
  const provider = Deno.env.get("PAYMENT_PROVIDER")?.trim().toLowerCase();
  return (
    enabled(Deno.env.get("MERCADO_PAGO_ENABLED")) ||
    provider === "mercadopago" ||
    provider === "mercado_pago"
  );
};

export const integrationDisabledPayload = (requestId?: string) => ({
  success: false,
  code: "INTEGRATION_DISABLED",
  message: "Esta integração ainda não está disponível.",
  ...(requestId ? { request_id: requestId } : {})
});
