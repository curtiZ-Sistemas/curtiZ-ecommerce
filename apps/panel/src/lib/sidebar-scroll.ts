type ScrollStorage = Pick<Storage, "getItem" | "setItem">;

export const panelSidebarScrollKey = (role: string) => `curtiz:panel-sidebar:${role}`;

export function readSidebarScroll(storage: ScrollStorage, key: string): number {
  const value = Number(storage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function writeSidebarScroll(storage: ScrollStorage, key: string, scrollTop: number) {
  storage.setItem(key, String(Math.max(0, Math.round(scrollTop))));
}

export function keepActiveItemVisible(
  scrollTop: number,
  viewportHeight: number,
  itemTop: number,
  itemHeight: number,
  margin = 12
) {
  if (itemTop < scrollTop + margin) return Math.max(0, itemTop - margin);
  const itemBottom = itemTop + itemHeight;
  const viewportBottom = scrollTop + viewportHeight - margin;
  return itemBottom > viewportBottom
    ? Math.max(0, itemBottom - viewportHeight + margin)
    : scrollTop;
}
