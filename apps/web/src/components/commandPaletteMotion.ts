import type { LegendListRef } from "@legendapp/list/react";
import { observeResize } from "../lib/observeResize";

export function trackCommandPaletteFilters(nav: HTMLElement | null) {
  const mark = nav?.querySelector<HTMLElement>(".command-palette-filter-pill");
  if (!nav || !mark) return;
  let shown = false;
  const place = (instant: boolean) => {
    const selected = nav.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!selected) return;
    const width = selected.offsetWidth;
    const left = selected.offsetLeft;
    const top = selected.offsetTop;
    mark.toggleAttribute("data-instant", instant || !shown);
    mark.style.width = `${width}px`;
    mark.style.transform = `translate(${left}px, ${top}px)`;
    nav.setAttribute("data-command-filter-ready", "");
    shown = true;
  };
  place(true);
  const observer = new MutationObserver(() => place(false));
  observer.observe(nav, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  const stopResize = observeResize(nav, () => place(true));
  return () => {
    observer.disconnect();
    stopResize();
  };
}

// OpenBot's global-search-motion, adapted to T3's existing virtualized rows and dialog lifecycle.
export function trackCommandPaletteResults(list: LegendListRef): () => void {
  const scroller = list.getScrollableNode();
  const results = scroller.closest<HTMLElement>("[data-slot=command-list]");
  if (!results?.closest('[data-command-palette][data-palette-mode="command"]'))
    return () => undefined;

  const mark = document.createElement("div");
  mark.className = "command-palette-highlight";
  mark.setAttribute("aria-hidden", "true");
  scroller.append(mark);
  scroller.setAttribute("data-command-highlight-ready", "");
  let shown = false;
  const place = (instant: boolean) => {
    const row =
      scroller.querySelector<HTMLElement>('[data-slot="command-item"][data-active="true"]') ??
      scroller.querySelector<HTMLElement>('[data-slot="command-item"][data-highlighted]');
    if (!row) {
      mark.hidden = true;
      shown = false;
      return;
    }
    // LegendList positions recycled row containers with transforms, so offsetTop is insufficient.
    const rowRect = row.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const scale = viewport.height / scroller.offsetHeight || 1;
    const top = (rowRect.top - viewport.top) / scale + scroller.scrollTop - scroller.clientTop;
    mark.hidden = false;
    mark.toggleAttribute("data-instant", instant || !shown);
    mark.style.height = `${rowRect.height / scale}px`;
    mark.style.transform = `translateY(${top}px)`;
    shown = true;
  };
  place(true);
  const observer = new MutationObserver((records) => {
    const changes = records.filter((record) => record.target !== mark);
    if (changes.length === 0) return;
    place(changes.some((record) => record.attributeName === "data-command-list-key"));
  });
  observer.observe(results, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-active", "data-highlighted", "data-command-list-key", "style"],
  });

  const previousHeight = results.style.height;
  let heightPlaced = false;
  const setHeight = (contentLength: number) => {
    if (!Number.isFinite(contentLength)) return;
    results.toggleAttribute("data-height-instant", !heightPlaced);
    results.style.height = `${Math.max(36, contentLength) + 12}px`;
    heightPlaced = true;
  };
  setHeight(list.getState().contentLength);
  const stopHeight = list.getState().listen("totalSize", setHeight);
  const stopResize = observeResize(scroller, () => place(true));
  return () => {
    observer.disconnect();
    stopHeight();
    stopResize();
    mark.remove();
    scroller.removeAttribute("data-command-highlight-ready");
    results.removeAttribute("data-height-instant");
    results.style.height = previousHeight;
  };
}
