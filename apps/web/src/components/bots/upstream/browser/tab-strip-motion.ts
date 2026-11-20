import { observeResize } from "../../../../lib/observeResize";
/* oxlint-disable t3code/no-low-value-comments -- Pinned source drag threshold, edge scroll, FLIP and pointer-close width retention. */
import type { BrowserViewProps } from "./types";
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motionDuration = (name: string, fallback: number) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.endsWith("ms")
    ? parseFloat(value)
    : value.endsWith("s")
      ? parseFloat(value) * 1000
      : fallback;
};
const DRAG_START_PX = 6;
/** A held tab this close to an edge of the row scrolls the row, at up to this many pixels a frame. */
const EDGE_ZONE_PX = 40;
const EDGE_SPEED_PX = 14;

/** What the row shows besides the tabs: the chips out of view, the faded edges, and a kept chip width. */
export interface TabRow {
  hidden: string[];
  fadeStart: boolean;
  fadeEnd: boolean;
  frozen: number;
}

interface TabDrag {
  id: string;
  pointerId: number;
  startX: number;
  startScroll: number;
  /** The pointer now. */
  x: number;
  active: boolean;
  /** Where each chip was when the drag started, in row coordinates. */
  slots: { el: HTMLElement; left: number; width: number }[];
  gap: number;
  from: number;
  to: number;
  frame: number;
}

/**
 * Slides the chips from their last places to their new places (FLIP). The tabs change after an answer
 * from the host, so the row keeps the places of its last layout rather than measuring before a change.
 * A new chip fades in.
 */
function createChipMotion(chips: () => HTMLElement[]) {
  let places = new Map<string, number>();
  const read = () => new Map(chips().map((el) => [el.dataset.tabId ?? "", el.offsetLeft]));
  return {
    /** Keeps the places of the layout now, without a slide. */
    keep: (override?: Map<string, number>) => {
      places = override ?? read();
    },
    play: () => {
      const before = places;
      const elements = chips();
      places = read();
      if (before.size === 0 || prefersReducedMotion() || elements.some((el) => !el.isConnected))
        return;
      const timing = {
        duration: motionDuration("--openbot-duration-normal", 160),
        easing:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--openbot-ease-out")
            .trim() || "ease-out",
      };
      for (const el of elements) {
        const id = el.dataset.tabId ?? "";
        const left = before.get(id);
        const now = places.get(id) ?? 0;
        if (left === undefined) {
          for (const animation of el.getAnimations()) animation.cancel();
          el.animate(
            [
              { opacity: 0, transform: "scale(0.94)" },
              { opacity: 1, transform: "none" },
            ],
            timing,
          );
          continue;
        }
        const dx = left - now;
        if (Math.abs(dx) < 0.5) continue;
        for (const animation of el.getAnimations()) animation.cancel();
        el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
      }
    },
  };
}

/**
 * Every tab, as the chips of the top row.
 * - Drag a chip to move it: the other chips slide out of its way, and near an edge the row scrolls.
 *   Escape puts it back.
 * - A middle click, Delete or the X closes a tab. After a close with the pointer, the chips keep their
 *   width until the pointer leaves the row, so the next X is under the pointer.
 * - A right click (or Control-click) opens the tab menu.
 * - When the chips do not fit, the row scrolls (also with a vertical wheel), its edges fade, and a
 *   menu lists the tabs out of view.
 */

export function connectTabStrip(
  strip: HTMLElement,
  getView: () => BrowserViewProps,
  setRow: (change: (state: TabRow) => void) => void,
  onClose: (ids: readonly string[]) => void,
) {
  let drag: TabDrag | undefined;
  let swallowClick = false;
  let measureFrame = 0;

  const activeId = () => getView().activeTab?.id;
  const canClose = () => getView().canCloseTabs !== false;
  const chips = () =>
    strip ? [...strip.querySelectorAll<HTMLElement>(":scope > [data-tab-id]")] : [];
  const chip = (id: string) => chips().find((el) => el.dataset.tabId === id);
  const motion = createChipMotion(chips);

  /** Scrolls only the row, not the window, until the chip of the tab shows whole. */
  const reveal = (id: string) => {
    const el = chip(id);
    if (!strip || !el) return;
    const inset = Number.parseFloat(getComputedStyle(strip).paddingInlineStart) || 0;
    const left = el.offsetLeft - inset;
    const right = el.offsetLeft + el.offsetWidth + inset;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (left < strip.scrollLeft) strip.scrollTo({ left, behavior });
    else if (right > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: right - strip.clientWidth, behavior });
  };

  /** Finds the chips out of view. Offsets ignore the slides, so a moving chip counts at its new place. */
  const measureRow = () => {
    measureFrame = 0;
    if (!strip) return;
    const start = strip.scrollLeft;
    const end = start + strip.clientWidth;
    const width = strip.scrollWidth;
    const hidden = chips()
      .filter((el) => el.offsetLeft < start - 1 || el.offsetLeft + el.offsetWidth > end + 1)
      .map((el) => el.dataset.tabId ?? "");
    setRow((state) => {
      if (state.hidden.join() !== hidden.join()) state.hidden = hidden;
      state.fadeStart = start > 1;
      state.fadeEnd = end < width - 1;
    });
    if (!drag?.active) motion.keep();
  };
  const scheduleMeasure = () => {
    if (!measureFrame) measureFrame = requestAnimationFrame(measureRow);
  };

  const close = (ids: readonly string[]) => {
    if (canClose()) onClose(ids);
  };
  const closeWithPointer = (id: string) => {
    if (!canClose()) return;
    const width = chip(id)?.offsetWidth;
    if (width)
      setRow((state) => {
        state.frozen = width;
      });
    close([id]);
  };

  /** Puts the held chip under the pointer and moves the chips between its old and new place by one slot. */
  const layout = (current: TabDrag) => {
    const held = current.slots[current.from];
    const first = current.slots[0];
    const last = current.slots.at(-1);
    if (!strip || !held || !first || !last) return;
    const offset = clamp(
      current.x - current.startX + strip.scrollLeft - current.startScroll,
      first.left - held.left,
      last.left + last.width - held.left - held.width,
    );
    const center = held.left + offset + held.width / 2;
    current.to = current.slots.filter(
      (slot, index) => index !== current.from && slot.left + slot.width / 2 < center,
    ).length;
    const step = held.width + current.gap;
    current.slots.forEach((slot, index) => {
      const shift =
        index === current.from
          ? offset
          : index > current.from && index <= current.to
            ? -step
            : index < current.from && index >= current.to
              ? step
              : 0;
      slot.el.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  };

  const edgeScroll = () => {
    const current = drag;
    if (!current?.active || !strip) return;
    const rect = strip.getBoundingClientRect();
    const speed =
      current.x < rect.left + EDGE_ZONE_PX
        ? -(1 - Math.max(0, current.x - rect.left) / EDGE_ZONE_PX)
        : current.x > rect.right - EDGE_ZONE_PX
          ? 1 - Math.max(0, rect.right - current.x) / EDGE_ZONE_PX
          : 0;
    if (speed) {
      strip.scrollLeft += speed * EDGE_SPEED_PX;
      layout(current);
    }
    current.frame = requestAnimationFrame(edgeScroll);
  };

  const finishDrag = (drop: boolean) => {
    const current = drag;
    drag = undefined;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onDragKey, true);
    if (!current?.active || !strip) return;
    cancelAnimationFrame(current.frame);
    // The release also clicks the chip or its X; that click is part of the drag.
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    });
    // The chips settle from where they are drawn now.
    const origin = strip.getBoundingClientRect().left - strip.scrollLeft + strip.clientLeft;
    motion.keep(
      new Map(
        current.slots.map((slot) => [
          slot.el.dataset.tabId ?? "",
          slot.el.getBoundingClientRect().left - origin,
        ]),
      ),
    );
    for (const slot of current.slots) {
      slot.el.style.transform = "";
      slot.el.removeAttribute("data-dragging");
    }
    strip.removeAttribute("data-dragging");
    if (drop && current.to !== current.from) getView().onMoveTab(current.id, current.to);
    // A drop in place changes no tab, so the held chip slides back here.
    else motion.play();
  };

  function onPointerMove(event: PointerEvent) {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId || !strip) return;
    current.x = event.clientX;
    if (!current.active) {
      if (Math.abs(current.x - current.startX) < DRAG_START_PX) return;
      current.slots = chips().map((el) => ({ el, left: el.offsetLeft, width: el.offsetWidth }));
      current.from = current.slots.findIndex((slot) => slot.el.dataset.tabId === current.id);
      if (current.from < 0) return finishDrag(false);
      current.active = true;
      current.to = current.from;
      current.startScroll = strip.scrollLeft;
      current.gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
      for (const slot of current.slots)
        for (const animation of slot.el.getAnimations()) animation.cancel();
      current.slots[current.from]?.el.setAttribute("data-dragging", "");
      strip.setAttribute("data-dragging", "");
      if (activeId() !== current.id) getView().onActivateTab(current.id);
      current.frame = requestAnimationFrame(edgeScroll);
    }
    event.preventDefault();
    layout(current);
  }
  function onPointerUp(event: PointerEvent) {
    if (event.pointerId === drag?.pointerId) finishDrag(true);
  }
  function onPointerCancel(event: PointerEvent) {
    if (event.pointerId === drag?.pointerId) finishDrag(false);
  }
  function onDragKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag(false);
  }

  const onChipPointerDown = (event: PointerEvent, id: string) => {
    // The middle button closes on release (auxclick); here it only stops the scroll cursor.
    if (event.button === 1) event.preventDefault();
    // Control-click is the right click of macOS: its menu takes the release, so no drag starts.
    // A touch scrolls the row; a long press opens the menu.
    if (event.button !== 0 || event.pointerType === "touch" || event.ctrlKey || drag) return;
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: 0,
      x: event.clientX,
      active: false,
      slots: [],
      gap: 0,
      from: -1,
      to: -1,
      frame: 0,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onDragKey, true);
  };

  const mount = () => {
    const element = strip;
    if (!element) return () => {};
    const stopResize = observeResize(element, scheduleMeasure);
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    // A vertical wheel scrolls the row, as in other browsers.
    const onWheel = (event: WheelEvent) => {
      if (
        Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
        element.scrollWidth <= element.clientWidth
      )
        return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener("click", onClick, true);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    element.addEventListener("transitionend", scheduleMeasure);
    return () => {
      finishDrag(false);
      stopResize();
      cancelAnimationFrame(measureFrame);
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("scroll", scheduleMeasure);
      element.removeEventListener("transitionend", scheduleMeasure);
    };
  };

  const stop = mount();
  return {
    onChipPointerDown,
    closeWithPointer,
    reveal,
    sync: (id: string | undefined) => {
      motion.play();
      scheduleMeasure();
      if (id) reveal(id);
    },
    dispose: () => stop?.(),
  };
}
