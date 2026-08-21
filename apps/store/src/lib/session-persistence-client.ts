export const PERSISTENT_CART_KEY = "curtiz-cart";
export const SESSION_CART_KEY = "curtiz-session-cart";
export const PERSISTENT_CART_SELECTION_KEY = "curtiz-cart-selection";
export const SESSION_CART_SELECTION_KEY = "curtiz-session-cart-selection";
export const PERSISTENT_CART_SYNC_KEY = "curtiz-cart-sync-id";
export const SESSION_CART_SYNC_KEY = "curtiz-session-cart-sync-id";
const persistentMarkerKey = "curtiz-auth-persistence";
const sessionMarkerKey = "curtiz-auth-session";

export type ClientPersistence = "persistent" | "session";

export function readClientPersistence(
  sessionStorage: Pick<Storage, "getItem"> = window.sessionStorage
): ClientPersistence {
  if (sessionStorage.getItem(sessionMarkerKey) === "session") return "session";
  return "persistent";
}

export function setClientAuthPersistence(
  persistent: boolean,
  persistentStorage: Storage = window.localStorage,
  sessionStorage: Storage = window.sessionStorage
) {
  const source = persistent ? sessionStorage : persistentStorage;
  const target = persistent ? persistentStorage : sessionStorage;
  const sourceCartKey = persistent ? SESSION_CART_KEY : PERSISTENT_CART_KEY;
  const targetCartKey = persistent ? PERSISTENT_CART_KEY : SESSION_CART_KEY;
  const sourceSelectionKey = persistent
    ? SESSION_CART_SELECTION_KEY
    : PERSISTENT_CART_SELECTION_KEY;
  const targetSelectionKey = persistent
    ? PERSISTENT_CART_SELECTION_KEY
    : SESSION_CART_SELECTION_KEY;
  const sourceSyncKey = persistent ? SESSION_CART_SYNC_KEY : PERSISTENT_CART_SYNC_KEY;
  const targetSyncKey = persistent ? PERSISTENT_CART_SYNC_KEY : SESSION_CART_SYNC_KEY;
  const cart = source.getItem(sourceCartKey);
  const selection = source.getItem(sourceSelectionKey);
  const syncId = source.getItem(sourceSyncKey);
  if (cart) target.setItem(targetCartKey, cart);
  if (selection) target.setItem(targetSelectionKey, selection);
  if (syncId) target.setItem(targetSyncKey, syncId);
  source.removeItem(sourceCartKey);
  source.removeItem(sourceSelectionKey);
  source.removeItem(sourceSyncKey);
  if (persistent) {
    persistentStorage.setItem(persistentMarkerKey, "persistent");
    sessionStorage.removeItem(sessionMarkerKey);
  } else {
    sessionStorage.setItem(sessionMarkerKey, "session");
    persistentStorage.removeItem(persistentMarkerKey);
  }
  window.dispatchEvent(new Event("curtiz-auth-persistence-changed"));
}

export function clearClientSessionState(
  persistentStorage: Storage = window.localStorage,
  sessionStorage: Storage = window.sessionStorage
) {
  for (const key of [
    PERSISTENT_CART_KEY,
    PERSISTENT_CART_SELECTION_KEY,
    PERSISTENT_CART_SYNC_KEY,
    persistentMarkerKey
  ]) {
    persistentStorage.removeItem(key);
  }
  for (const key of [
    SESSION_CART_KEY,
    SESSION_CART_SELECTION_KEY,
    SESSION_CART_SYNC_KEY,
    sessionMarkerKey
  ]) {
    sessionStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("curtiz-session-state-cleared"));
}
