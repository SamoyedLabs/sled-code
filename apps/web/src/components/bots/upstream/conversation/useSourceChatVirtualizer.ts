import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";
import {
  Virtualizer,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  type VirtualItem,
} from "@tanstack/virtual-core";
import { observeResize } from "../../../../lib/observeResize";

// OpenBot createChatVirtualizer with a 20-row static window, 56px estimate, five-row overscan,
// end anchoring and an 80px follow threshold. React subscribes to range changes, not scroll frames.
export function useSourceChatVirtualizer<
  S extends HTMLElement = HTMLDivElement,
  R extends HTMLElement = HTMLDivElement,
>(
  list: RefObject<S | null>,
  root: RefObject<HTMLElement | null>,
  ids: readonly string[],
  sticky: RefObject<boolean>,
) {
  const version = JSON.stringify(ids);
  const hasRows = ids.length > 0;
  const [store] = useState(() => {
    const listeners = new Set<() => void>();
    const first = ids.length <= 20 ? 0 : Math.max(0, ids.length - 10);
    let keyVersion = version;
    let initialFollow = ids.length > 0 && sticky.current;
    let snapshot: {
      keyVersion: string;
      items: VirtualItem[];
      total: number;
      margin: number;
      virtualized: boolean;
    } = {
      keyVersion: version,
      items: ids.slice(first).map((key, offset) => {
        const index = first + offset,
          start = index * 56;
        return { key, index, start, end: start + 56, size: 56, lane: 0 };
      }),
      total: ids.length * 56,
      margin: 0,
      virtualized: ids.length > 20,
    };
    const instance = new Virtualizer<S, R>({
      count: 0,
      getScrollElement: () => list.current,
      estimateSize: () => 56,
      getItemKey: (index) => index,
      observeElementRect,
      observeElementOffset,
      measureElement: (element, entry, virtualizer) => {
        virtualizer.options.scrollEndThreshold = sticky.current ? 80 : -1;
        return measureElement(element, entry, virtualizer);
      },
      scrollToFn: (offset, scroll, virtualizer) => {
        const element = virtualizer.scrollElement;
        if (element && scroll.adjustments !== undefined && sticky.current) {
          elementScroll(
            element.scrollHeight - element.clientHeight,
            { ...scroll, adjustments: 0 },
            virtualizer,
          );
          return;
        }
        elementScroll(offset, scroll, virtualizer);
      },
      overscan: 5,
      anchorTo: "end",
      followOnAppend: "auto",
      scrollEndThreshold: 80,
      initialRect: { width: 1, height: 600 },
    });
    const publish = () => {
      const count = instance.options.count,
        margin = instance.options.scrollMargin ?? 0;
      const measured = instance.getVirtualItems();
      const fallback = count <= 20 || measured.length === 0;
      const first = count <= 20 ? 0 : Math.max(0, count - 10);
      const items = fallback
        ? Array.from({ length: count - first }, (_, offset) => {
            const index = first + offset,
              start = margin + index * 56;
            return {
              index,
              key: instance.options.getItemKey(index),
              start,
              end: start + 56,
              size: 56,
              lane: 0,
            };
          })
        : [...measured];
      const total = instance.getTotalSize() || count * 56;
      if (
        snapshot.keyVersion === keyVersion &&
        snapshot.total === total &&
        snapshot.margin === margin &&
        snapshot.virtualized === count > 20 &&
        snapshot.items.length === items.length &&
        items.every((item, index) => {
          const old = snapshot.items[index];
          return (
            old?.key === item.key &&
            old.start === item.start &&
            old.size === item.size &&
            old.index === item.index
          );
        })
      )
        return;
      snapshot = { keyVersion, items, total, margin, virtualized: count > 20 };
      for (const listener of listeners) listener();
    };
    return {
      instance,
      setKeys: (value: string) => {
        if (instance.options.count === 0 && value !== "[]") initialFollow = sticky.current;
        keyVersion = value;
      },
      followInitial: () => {
        if (!initialFollow || !list.current || !root.current || root.current.scrollHeight === 0)
          return;
        initialFollow = false;
        sticky.current = true;
        list.current.scrollTop = list.current.scrollHeight;
      },
      publish,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  });
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Update the external source virtualizer only when row identity changes; row sizes come from its measurement observer.
  useLayoutEffect(() => {
    const keys: string[] = JSON.parse(version);
    store.setKeys(version);
    store.instance.setOptions({
      ...store.instance.options,
      count: keys.length,
      getItemKey: (index) => keys[index] ?? index,
      scrollEndThreshold: sticky.current ? 80 : -1,
      onChange: store.publish,
    });
    store.instance._willUpdate();
    store.publish();
    store.followInitial();
  }, [version, store, sticky]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own and dispose virtualizer scroll/size subscriptions and measure the original root margin through T3's shared observer.
  useLayoutEffect(() => {
    const measureMargin = () => {
      if (!list.current || !root.current) return;
      store.followInitial();
      const margin = Math.max(
        0,
        root.current.getBoundingClientRect().top -
          list.current.getBoundingClientRect().top +
          list.current.scrollTop,
      );
      if (margin !== store.instance.options.scrollMargin) {
        store.instance.setOptions({ ...store.instance.options, scrollMargin: margin });
        store.instance._willUpdate();
        store.publish();
      }
    };
    if (!hasRows) return;
    const elements = [list.current, root.current].filter(
      (element): element is HTMLElement => element !== null,
    );
    const unobserve = observeResize(elements, measureMargin);
    measureMargin();
    store.publish();
    return unobserve;
  }, [store, list, root, hasRows]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the external virtualizer's observer and scroll ownership exactly once.
  useLayoutEffect(() => store.instance._didMount(), [store]);
  // New data must render a usable fallback before layout effects configure the external range.
  // Otherwise a conversation that first loads after mount cannot anchor to its real bottom.
  const first = ids.length <= 20 ? 0 : Math.max(0, ids.length - 10);
  const shown =
    state.keyVersion === version
      ? state
      : {
          keyVersion: version,
          margin: state.margin,
          total: ids.length * 56,
          virtualized: ids.length > 20,
          items: ids.slice(first).map((key, offset) => {
            const index = first + offset,
              start = state.margin + index * 56;
            return { key, index, start, end: start + 56, size: 56, lane: 0 };
          }),
        };
  return {
    ...shown,
    instance: store.instance,
    scrollToEnd: () => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      if (shown.virtualized) store.instance.scrollToEnd({ behavior });
      else list.current?.scrollTo({ top: list.current.scrollHeight, behavior });
    },
  };
}
