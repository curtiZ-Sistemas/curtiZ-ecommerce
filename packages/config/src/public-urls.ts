export type PublicAppUrls = {
  storeUrl: string;
  panelUrl: string;
};

type PublicAppUrlConfiguration = PublicAppUrls & {
  storeTestUrl?: string;
  panelTestUrl?: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const origin = (value: string | undefined, fallback?: string): string | undefined => {
  const candidate = value?.trim() || fallback;
  if (!candidate) return undefined;

  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
};

export const configuredPublicAppUrls = (): PublicAppUrlConfiguration => ({
  storeUrl: origin(process.env.NEXT_PUBLIC_STORE_URL, "http://localhost:3000")!,
  panelUrl: origin(process.env.NEXT_PUBLIC_PANEL_URL, "http://localhost:3001")!,
  storeTestUrl: origin(process.env.NEXT_PUBLIC_STORE_TEST_URL),
  panelTestUrl: origin(process.env.NEXT_PUBLIC_PANEL_TEST_URL)
});

export const configuredPublicOrigins = (): Set<string> => {
  const urls = configuredPublicAppUrls();
  return new Set(
    [urls.storeUrl, urls.panelUrl, urls.storeTestUrl, urls.panelTestUrl].filter(
      (value): value is string => Boolean(value)
    )
  );
};

export const resolvePublicAppUrls = (currentUrl?: string | URL): PublicAppUrls => {
  const configured = configuredPublicAppUrls();
  const currentOrigin = origin(currentUrl?.toString());

  if (currentOrigin) {
    if (
      configured.storeTestUrl &&
      configured.panelTestUrl &&
      (currentOrigin === configured.storeTestUrl || currentOrigin === configured.panelTestUrl)
    ) {
      return {
        storeUrl: configured.storeTestUrl,
        panelUrl: configured.panelTestUrl
      };
    }

    try {
      const current = new URL(currentOrigin);
      if (LOCAL_HOSTS.has(current.hostname)) {
        return {
          storeUrl: `${current.protocol}//${current.hostname}:3000`,
          panelUrl: `${current.protocol}//${current.hostname}:3001`
        };
      }
    } catch {
      // A origem já foi validada; mantém o par canônico como fallback defensivo.
    }
  }

  return {
    storeUrl: configured.storeUrl,
    panelUrl: configured.panelUrl
  };
};
