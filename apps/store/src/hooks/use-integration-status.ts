"use client";

import { useEffect, useState } from "react";

export type PublicIntegrationStatus = {
  checkoutEnabled: boolean;
  paymentEnabled: boolean;
  shippingEnabled: boolean;
  emailEnabled: boolean;
  turnstileEnabled: boolean;
};

const disabledStatus: PublicIntegrationStatus = {
  checkoutEnabled: false,
  paymentEnabled: false,
  shippingEnabled: false,
  emailEnabled: false,
  turnstileEnabled: false
};

export function useIntegrationStatus() {
  const [status, setStatus] = useState<PublicIntegrationStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return disabledStatus;
        return (await response.json()) as PublicIntegrationStatus;
      })
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setStatus(disabledStatus);
      });
    return () => controller.abort();
  }, []);

  return status;
}
