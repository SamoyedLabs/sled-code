import { flushSync } from "react-dom";
import { observeResize } from "../../../lib/observeResize";
import { threadTabDrop } from "./openbotThreadTabLayout";
export type OpenbotThreadTab = {
  id: string;
  title: string;
  state: string;
  outcome?: string | null;
};
type Carry = { thread: OpenbotThreadTab; from: "chat" | "side"; x: number; y: number };
let carry: Carry | null = null;
const listeners = new Set<() => void>();
export const threadTabCarry = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => carry,
};
function setCarry(next: Carry | null) {
  carry = next;
  for (const listener of listeners) listener();
}
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  requestAnimationFrame(() => window.removeEventListener("click", swallow, { capture: true }));
}
type Options = {
  row: "chat" | "side";
  getThreads: () => readonly OpenbotThreadTab[];
  onMove: (id: string, index: number) => void;
  onDock?: ((id: string) => void) | undefined;
  isMaximized?: () => boolean;
  fill?: HTMLElement | null;
  onMode?: (mode: "tabs" | "compact" | "minimal") => void;
};
export function bindThreadTabDrag(element: HTMLElement, options: Options) {
  const selector = options.row === "chat" ? ".agent-threads-tab" : ".side-panel-thread-tab";
  const tabs = () => [...element.querySelectorAll<HTMLElement>(selector)];
  const header = element.closest<HTMLElement>(".conversation-header");
  let disposed = false,
    modelStep = 0,
    modelSliding = false,
    keyAt = Number.NEGATIVE_INFINITY;
  let drag: {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    startScroll: number;
    x: number;
    moving: boolean;
    away: boolean;
    target: number;
    frame: number;
  } | null = null;
  const edges = () => {
    element.toggleAttribute("data-more-before", element.scrollLeft > 1);
    element.toggleAttribute(
      "data-more-after",
      element.scrollLeft < element.scrollWidth - element.clientWidth - 1,
    );
  };
  const showModel = (step: number) => {
    modelStep = step;
    if (!header) return;
    if (step === 0) delete header.dataset.modelFit;
    else header.dataset.modelFit = step === 1 ? "short" : "icon";
  };
  const overflows = () => {
    if (element.scrollWidth - element.clientWidth > 1) return true;
    const tab = tabs()[0];
    return (
      !!tab &&
      tab.getBoundingClientRect().width < Number.parseFloat(getComputedStyle(tab).maxWidth) - 0.5
    );
  };
  const fitModel = () => {
    if (!header || modelSliding || options.row !== "chat") return;
    const before = modelStep;
    header.dataset.modelMeasure = "";
    while (modelStep < 2 && overflows()) {
      modelStep += 1;
      showModel(modelStep);
    }
    if (!overflows())
      while (modelStep > 0) {
        const previous = modelStep;
        modelStep -= 1;
        showModel(modelStep);
        if (!overflows()) continue;
        showModel(previous);
        break;
      }
    const after = modelStep;
    showModel(before);
    header.getBoundingClientRect();
    delete header.dataset.modelMeasure;
    if (before === after) return;
    header.getBoundingClientRect();
    showModel(after);
    header.getBoundingClientRect();
    modelSliding = true;
    void Promise.allSettled(
      (header.querySelector(".provider-model-trigger")?.getAnimations({ subtree: true }) ?? []).map(
        (animation) => animation.finished,
      ),
    ).then(() => {
      modelSliding = false;
      if (!disposed) measure();
    });
  };
  const fill = () => {
    const selected = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (options.fill) {
      options.fill.style.width = `${selected?.offsetWidth ?? 0}px`;
      options.fill.style.transform = `translateX(${selected?.offsetLeft ?? 0}px)`;
      options.fill.style.opacity = selected ? "1" : "0";
    }
    return selected;
  };
  const measure = () => {
    fitModel();
    const selected = fill();
    if (selected && !drag?.moving) {
      const left = selected.offsetLeft - 24,
        right = selected.offsetLeft + selected.offsetWidth + 24 - element.clientWidth;
      if (left < element.scrollLeft) element.scrollLeft = left;
      else if (right > element.scrollLeft) element.scrollLeft = right;
    }
    edges();
  };
  const clear = () => {
    for (const tab of tabs()) tab.style.transform = "";
    fill();
  };
  const reorder = (id: string, index: number) => {
    const focused = document.activeElement;
    const before = new Map(tabs().map((tab) => [tab, tab.getBoundingClientRect().left]));
    for (const tab of before.keys()) {
      tab.style.transition = "none";
      tab.style.transform = "";
    }
    flushSync(() => options.onMove(id, index));
    measure();
    for (const [tab, left] of before) {
      const offset = left - tab.getBoundingClientRect().left;
      if (Math.abs(offset) > 0.5) tab.style.transform = `translateX(${offset}px)`;
    }
    element.getBoundingClientRect();
    for (const tab of before.keys()) {
      tab.style.transition = "";
      tab.style.transform = "";
    }
    if (focused instanceof HTMLElement && focused.isConnected && focused !== document.activeElement)
      focused.focus({ preventScroll: true });
  };
  const follow = () => {
    if (!drag) return;
    const items = tabs().map((tab) => ({
      id: tab.dataset.threadId ?? "",
      left: tab.offsetLeft,
      width: tab.offsetWidth,
    }));
    const placement = threadTabDrop(
      items,
      drag.id,
      drag.x - drag.startX + (options.row === "chat" ? element.scrollLeft - drag.startScroll : 0),
      Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      options.row,
    );
    if (!placement) return;
    drag.target = placement.target;
    for (const shift of placement.shifts) {
      const tab = tabs().find((node) => node.dataset.threadId === shift.id);
      if (tab) tab.style.transform = shift.x ? `translateX(${shift.x}px)` : "";
    }
    if (
      options.fill &&
      element.querySelector('[aria-selected="true"]')?.getAttribute("data-thread-id") === drag.id
    ) {
      const current = tabs().find((tab) => tab.dataset.threadId === drag?.id);
      options.fill.style.transform = `translateX(${(current?.offsetLeft ?? 0) + placement.offset}px)`;
    }
  };
  const autoScroll = () => {
    if (!drag?.moving) return;
    if (!drag.away && options.row === "chat") {
      const box = element.getBoundingClientRect();
      const speed =
        drag.x < box.left + 40
          ? -(box.left + 40 - drag.x) / 3
          : drag.x > box.right - 40
            ? (drag.x - box.right + 40) / 3
            : 0;
      if (speed) {
        element.scrollLeft += Math.max(-12, Math.min(12, speed));
        follow();
      }
    }
    drag.frame = requestAnimationFrame(autoScroll);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    if (!drag.moving) {
      if (Math.hypot(drag.x - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.moving = true;
      element.dataset.dragging = "";
      drag.frame = requestAnimationFrame(autoScroll);
    }
    const panel = element
      .closest(".conversation-panel")
      ?.querySelector<HTMLElement>(":scope > .side-panel-header");
    const panelHeader =
      options.row === "side" ? element.closest<HTMLElement>(".side-panel-header") : panel;
    const rtl = panelHeader ? getComputedStyle(panelHeader).direction === "rtl" : false;
    const bounds = panelHeader?.getBoundingClientRect();
    const away =
      !!options.onDock &&
      !!bounds &&
      !(options.row === "side" && options.isMaximized?.()) &&
      (options.row === "chat"
        ? rtl
          ? event.clientX <= bounds.right
          : event.clientX >= bounds.left
        : rtl
          ? event.clientX > bounds.right
          : event.clientX < bounds.left);
    drag.away = away;
    tabs()
      .find((tab) => tab.dataset.threadId === drag?.id)
      ?.setAttribute("data-dragged", away ? "away" : "");
    const thread = options.getThreads().find((item) => item.id === drag?.id);
    if (away) {
      clear();
      setCarry(thread ? { thread, from: options.row, x: event.clientX, y: event.clientY } : null);
    } else {
      setCarry(null);
      follow();
    }
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  const end = (event: PointerEvent) => {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId) return;
    drag = null;
    stop();
    cancelAnimationFrame(current.frame);
    delete element.dataset.dragging;
    element.querySelector("[data-dragged]")?.removeAttribute("data-dragged");
    setCarry(null);
    if (!current.moving) return;
    swallowNextClick();
    if (event.type === "pointercancel") {
      clear();
      return;
    }
    if (current.away) {
      clear();
      options.onDock?.(current.id);
    } else reorder(current.id, current.target);
  };
  const start = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      drag ||
      !(event.target instanceof Element) ||
      event.target.closest(".agent-threads-tab-close,.side-panel-tab-close,input")
    )
      return;
    const id = event.target.closest<HTMLElement>(selector)?.dataset.threadId;
    if (!id || (tabs().length < 2 && !options.onDock)) return;
    drag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: element.scrollLeft,
      x: event.clientX,
      moving: false,
      away: false,
      target: 0,
      frame: 0,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const wheel = (event: WheelEvent) => {
    if (
      element.scrollWidth <= element.clientWidth ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    )
      return;
    event.preventDefault();
    element.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  };
  const onKey = (event: KeyboardEvent) => {
    keyAt = event.key === "Tab" ? Number.NEGATIVE_INFINITY : performance.now();
  };
  const focusSelected = () =>
    element
      .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  const keepFocus = (event: FocusEvent) => {
    if (performance.now() - keyAt > 500) return;
    if (event.target instanceof Node && element.contains(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".agent-threads-rename,[role=menu]")
    )
      return;
    focusSelected();
  };
  const pointer = () => {
    keyAt = Number.NEGATIVE_INFINITY;
  };
  let unobserve = observeResize([element, ...(header ? [header] : []), ...tabs()], measure);
  const mutation = new MutationObserver(() => {
    unobserve();
    unobserve = observeResize([element, ...(header ? [header] : []), ...tabs()], measure);
    measure();
    if (document.activeElement === document.body && performance.now() - keyAt < 500)
      focusSelected();
  });
  mutation.observe(element, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected"],
  });
  measure();
  const frame = requestAnimationFrame(() => options.fill?.removeAttribute("data-initializing"));
  element.addEventListener("pointerdown", start);
  element.addEventListener("scroll", edges, { passive: true });
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("keydown", onKey);
  document.addEventListener("focusin", keepFocus);
  document.addEventListener("pointerdown", pointer, true);
  return {
    move: (id: string, step: -1 | 1) => {
      const index = tabs().findIndex((tab) => tab.dataset.threadId === id) + step;
      if (index >= 0 && index < tabs().length) reorder(id, index);
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (drag) cancelAnimationFrame(drag.frame);
      setCarry(null);
      stop();
      clear();
      showModel(0);
      mutation.disconnect();
      unobserve();
      element.removeEventListener("pointerdown", start);
      element.removeEventListener("scroll", edges);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocus);
      document.removeEventListener("pointerdown", pointer, true);
    },
  };
}
export function bindThreadHeaderFit(
  row: HTMLElement,
  onMode: (mode: "tabs" | "compact" | "minimal") => void,
) {
  const group = row.parentElement;
  if (!group) return () => {};
  let mode: "tabs" | "compact" | "minimal" = "tabs",
    start = 0,
    chevronRoom = 0;
  const measure = () => {
    const button =
      row.querySelector<HTMLElement>(".agent-threads-icon-button")?.getBoundingClientRect().width ??
      28;
    const box = group.getBoundingClientRect();
    const rtl = getComputedStyle(group).direction === "rtl";
    const fromStart = (rect: DOMRect) => (rtl ? box.right - rect.right : rect.left - box.left);
    const toEnd = (rect: DOMRect) => (rtl ? box.right - rect.left : rect.right - box.left);
    if (mode !== "minimal") start = fromStart(row.getBoundingClientRect());
    const header = row.closest(".conversation-header");
    const picker = header?.querySelector(".provider-model-trigger");
    const gap = picker ? Number.parseFloat(getComputedStyle(picker).columnGap) || 0 : 0;
    const chevron = picker?.querySelector(".provider-model-chevron");
    if (chevron && chevron.getClientRects().length)
      chevronRoom = chevron.getBoundingClientRect().width + gap;
    const folded = row.dataset.fold;
    const width = box.width - (mode === "minimal" && folded && folded !== "name" ? chevronRoom : 0);
    let room = 0;
    for (const part of picker?.querySelectorAll(
      ".provider-model-trigger-name,.provider-model-trigger-effort",
    ) ?? []) {
      if (part.getClientRects().length)
        room +=
          part.getBoundingClientRect().width +
          gap +
          (Number.parseFloat(getComputedStyle(part).marginInlineStart) || 0);
    }
    const free = width - start - 2 * (button + 3) + Math.max(0, room);
    const next = free < 48 ? "minimal" : free < 200 ? "compact" : "tabs";
    if (next !== mode) {
      mode = next;
      onMode(next);
    }
    const title = group.firstElementChild;
    const avatar = title?.querySelector(".agent-avatar")?.getBoundingClientRect();
    const padding = title ? Number.parseFloat(getComputedStyle(title).paddingInlineStart) || 0 : 0;
    const avatarEnd = avatar ? toEnd(avatar) + padding + 1 : start;
    const pair = 2 * button + 3;
    const fold =
      width - start >= pair
        ? undefined
        : width - avatarEnd >= pair
          ? "name"
          : width + chevronRoom - avatarEnd >= button
            ? "new"
            : width + chevronRoom - avatarEnd >= -1
              ? "list"
              : "all";
    if (mode === "minimal" && fold) row.dataset.fold = fold;
    else delete row.dataset.fold;
  };
  const stop = observeResize([group], measure);
  measure();
  return stop;
}
