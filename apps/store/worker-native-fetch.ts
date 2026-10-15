// This module must be imported before OpenNext and every Next-dependent module.
// Static imports execute before the entry module body can capture native fetch.
const nativeFetch = globalThis.fetch;
const capturedFetch = nativeFetch.bind(globalThis);
export const scheduledFetch: typeof fetch = async (input, init) => {
  const redirect = init?.redirect
    ?? (typeof input === "object" && "redirect" in input ? input.redirect : undefined);
  if (redirect !== "error") return capturedFetch(input, init);

  // Workerd accepts only follow/manual. Preserve error-mode protection without
  // forwarding credentials or replaying a POST at a redirect destination.
  const response = await capturedFetch(input, { ...init, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    throw new TypeError("Scheduled fetch rejected an upstream redirect");
  }
  return response;
};
export const scheduledFetchWasPatched =
  (nativeFetch as typeof fetch & { __nextPatched?: boolean }).__nextPatched === true;
