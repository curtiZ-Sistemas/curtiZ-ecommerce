// This module must be imported before OpenNext and every Next-dependent module.
// Static imports execute before the entry module body can capture native fetch.
const nativeFetch = globalThis.fetch;
export const scheduledFetch = nativeFetch.bind(globalThis);
export const scheduledFetchWasPatched =
  (nativeFetch as typeof fetch & { __nextPatched?: boolean }).__nextPatched === true;
