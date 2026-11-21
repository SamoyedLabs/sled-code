// Ported from OpenBot packages/ui/src/menu-motion.tsx; timing, interpolation and handoff are unchanged.
// Base UI retains closed DOM, so its original is hidden while the inert source copy animates.
import type { Ref } from "react";

const SWAP_MS = 200;
const SWAP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SWAP_BLUR = "blur(2px)";
const LARGE_RESIZE = 1.5;
const LARGE_RESIZE_OUT_END = 0.3;
const LARGE_RESIZE_IN_START = 0.75;
// Kobalte opens a submenu 100 ms after the pointer reaches its trigger.
const HANDOFF_WAIT_MS = 180;
// Kobalte can open the next tooltip before the old one closes. The old one can still hand off to it
// within this time.
const LATE_HANDOFF_MS = 50;
const EXIT_FALLBACK_MS = 400;
const PLACEMENT_FRAMES = 6;

interface HeldSubmenu {
  copy: HTMLElement;
  panel: HTMLElement;

  group: Element;

  own: boolean;

  moving?: MovingState | undefined;

  natural?: DOMRect;

  itemWidths?: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface MotionPlace {
  trigger: Element;
  group: Element;
}

let held: HeldSubmenu | undefined;

let unmatched: { panel: HTMLElement; group: Element; since: number } | undefined;

const openInGroup = new Map<HTMLElement, Element>();

interface MovingState {
  rect: DOMRect;

  itemOpacity: number;

  surface: Keyframe;
}

const moves = new WeakMap<
  HTMLElement,
  {
    from: DOMRect;
    to: DOMRect;
    animation: Animation;
    large: boolean;
    surfaces: [Keyframe, Keyframe];
  }
>();

function movingState(panel: HTMLElement): MovingState | undefined {
  const move = moves.get(panel);
  const progress = move?.animation.effect?.getComputedTiming().progress;
  if (!move || move.animation.playState === "finished" || progress == null) return undefined;
  const mix = (from: number, to: number) => from + (to - from) * progress;
  return {
    rect: new DOMRect(
      mix(move.from.left, move.to.left),
      mix(move.from.top, move.to.top),
      mix(move.from.width, move.to.width),
      mix(move.from.height, move.to.height),
    ),
    itemOpacity: move.large
      ? Math.max(0, (progress - LARGE_RESIZE_IN_START) / (1 - LARGE_RESIZE_IN_START))
      : progress,
    surface: move.surfaces[progress < 0.5 ? 0 : 1],
  };
}

const scrollOffsets = new WeakMap<HTMLElement, Array<[index: number, top: number, left: number]>>();

function insertCopy(copy: HTMLElement, parent: Node): void {
  parent.appendChild(copy);
  const offsets = scrollOffsets.get(copy);
  if (!offsets) return;
  const elements = copy.querySelectorAll("*");
  for (const [index, top, left] of offsets) {
    const element = elements[index];
    if (!element) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

function motionAllowed(element: HTMLElement): boolean {
  return (
    typeof element.animate === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function positionerOf(panel: HTMLElement): HTMLElement | null {
  return panel.closest<HTMLElement>("[data-openbot-positioner]");
}

function triggerOf(panel: HTMLElement): HTMLElement | null {
  const id = panel.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

function parentMenuOf(trigger: HTMLElement | null): Element | null {
  return trigger?.closest(".ui-action-menu") ?? null;
}

function playExit(copy: HTMLElement, panel: HTMLElement): void {
  delete panel.dataset.menuHold;
  // Content with no exit animation in the stylesheet goes at once.
  if (panel.getAnimations().length === 0) {
    copy.remove();
    return;
  }
  const fallback = setTimeout(() => copy.remove(), EXIT_FALLBACK_MS);
  panel.addEventListener(
    "animationend",
    () => {
      clearTimeout(fallback);
      copy.remove();
    },
    { once: true },
  );
}

function releaseHeld(): void {
  if (!held) return;
  clearTimeout(held.timer);
  playExit(held.copy, held.panel);
  held = undefined;
}

function nextPanelExpected(panel: HTMLElement, own: MotionPlace | undefined): Element | null {
  if (own) {
    const waits =
      own.group.isConnected && own.group.matches(":hover") && !own.trigger.matches(":hover");
    return waits ? own.group : null;
  }
  const trigger = triggerOf(panel);
  const parentMenu = parentMenuOf(trigger);
  const nextTriggerHovered =
    trigger !== null &&
    parentMenu?.isConnected === true &&
    Array.from(parentMenu.querySelectorAll("[aria-expanded]")).some(
      (element) => element !== trigger && element.matches(":hover"),
    );
  return nextTriggerHovered ? parentMenu : null;
}

function leave(panel: HTMLElement, place: Node | null, own: MotionPlace | undefined): void {
  const positioner = positionerOf(panel);
  if (!positioner) return;
  // The copy is made now, while the content is still whole.
  const copy = positioner.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  const offsets: Array<[number, number, number]> = [];
  for (const [index, element] of Array.from(positioner.querySelectorAll("*")).entries()) {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0)
      offsets.push([index, element.scrollTop, element.scrollLeft]);
  }
  if (offsets.length > 0) scrollOffsets.set(copy, offsets);
  const copyPanel = panel.id ? copy.querySelector<HTMLElement>(`#${CSS.escape(panel.id)}`) : null;
  if (!copyPanel) return;
  copy.inert = true;
  // Base UI can hide its retained positioner after closing; the exit copy keeps its last placement.
  copy.hidden = false;
  copy.style.opacity = "1";
  copy.setAttribute("aria-hidden", "true");
  copy.style.pointerEvents = "none";
  // An SVG keeps its ids: a shape it draws through `url(#id)`, such as an avatar's mask, paints as
  // its bare box without them. The copy goes in only once the original has left the page.
  for (const element of copy.querySelectorAll("[id]"))
    if (!(element instanceof SVGElement)) element.removeAttribute("id");
  copyPanel.removeAttribute("data-open");
  copyPanel.removeAttribute("data-menu-original-closing");
  copyPanel.dataset.openbotMotionCopy = "";
  delete copyPanel.dataset.menuSwapIn;

  const group = nextPanelExpected(panel, own);
  if (group) {
    releaseHeld();
    copyPanel.dataset.menuHold = "";
    held = {
      copy,
      panel: copyPanel,
      group,
      own: own !== undefined,
      moving: movingState(panel),
      timer: setTimeout(releaseHeld, HANDOFF_WAIT_MS),
    };
  }

  panel.dataset.menuOriginalClosing = "";

  // The cleanup can run before the content leaves the page. React may remove it in the same commit, so
  // the copy goes in after that pass and before the next paint.
  queueMicrotask(() => {
    if (positioner.isConnected && panel.hasAttribute("data-open")) {
      if (held?.copy === copy) releaseHeld();
      return;
    }
    if (held?.copy === copy) {
      insertCopy(copy, document.body);
      holdInPlace(held);
      // A panel that does not match keeps its entry, so that its own timer shows it.
      const next = unmatched;
      if (
        next?.group === held.group &&
        next.panel.isConnected &&
        performance.now() - next.since < LATE_HANDOFF_MS
      ) {
        unmatched = undefined;
        handOff(held, next.panel);
      }
      return;
    }
    // Content without a portal goes back into its parent, so that its position stays right.
    insertCopy(copy, place?.isConnected ? place : document.body);
    playExit(copy, copyPanel);
  });
}

const translate = (to: DOMRect, from: DOMRect) =>
  `translate(${to.left - from.left}px, ${to.top - from.top}px)`;
const size = (rect: DOMRect) => ({ width: `${rect.width}px`, height: `${rect.height}px` });

const itemWidths = (panel: HTMLElement) =>
  Array.from(panel.children, (item) => `${item.getBoundingClientRect().width}px`);

const itemWidth = (from: HeldSubmenu, width: string | undefined): Keyframe =>
  from.own ? { width } : {};

function holdInPlace(from: HeldSubmenu): void {
  const natural = from.panel.getBoundingClientRect();
  from.natural = natural;
  const widths = itemWidths(from.panel);
  from.itemWidths = widths;
  const moving = from.moving;
  if (!moving) return;
  const hold: KeyframeAnimationOptions = { duration: 0, fill: "forwards" };
  from.panel.animate(
    [{ transform: translate(moving.rect, natural), ...size(moving.rect), ...moving.surface }],
    hold,
  );
  for (const [index, item] of Array.from(from.panel.children).entries())
    item.animate([{ opacity: moving.itemOpacity, ...itemWidth(from, widths[index]) }], hold);
}

function largeResize(before: DOMRect, after: DOMRect): boolean {
  const factor = (a: number, b: number) =>
    a > 0 && b > 0 ? Math.max(a / b, b / a) : Number.POSITIVE_INFINITY;
  return (
    Math.max(factor(before.width, after.width), factor(before.height, after.height)) > LARGE_RESIZE
  );
}

function surfaceOf(panel: HTMLElement): Keyframe {
  const style = getComputedStyle(panel);
  return {
    backgroundColor: style.backgroundColor,
    boxShadow: style.boxShadow,
    borderRadius: style.borderRadius,
  };
}

function whenPlaced(panel: HTMLElement, then: () => void, frame = 0): void {
  const positioner = positionerOf(panel);
  if (
    !panel.isConnected ||
    !panel.hasAttribute("data-open") ||
    (positioner && positioner.style.opacity !== "0") ||
    frame >= PLACEMENT_FRAMES
  ) {
    then();
    return;
  }
  requestAnimationFrame(() => whenPlaced(panel, then, frame + 1));
}

function handOff(from: HeldSubmenu, panel: HTMLElement): void {
  clearTimeout(from.timer);
  held = undefined;
  panel.dataset.menuHandoff = "";
  whenPlaced(panel, () => {
    if (!panel.isConnected || !panel.hasAttribute("data-open")) {
      playExit(from.copy, from.panel);
      return;
    }
    // The swap state comes before the handoff state goes: without either, the open animation starts
    // and the panel measures at its first-frame scale. It stays while the submenu is open, because
    // removing it would start the open animation again.
    panel.dataset.menuSwapIn = "";
    delete panel.dataset.menuHandoff;
    const natural = from.natural ?? from.panel.getBoundingClientRect();
    const before = from.moving?.rect ?? natural;
    const after = panel.getBoundingClientRect();
    const widths = itemWidths(panel);
    const oldWidths = from.itemWidths ?? itemWidths(from.panel);
    const timing: KeyframeAnimationOptions = { duration: SWAP_MS, easing: SWAP_EASE };

    // The old copy stays on top: its items leave over the new panel. Its surface is read before
    // the swap state makes it transparent.
    insertCopy(from.copy, document.body);
    const oldSurface = surfaceOf(from.panel);
    const newSurface = surfaceOf(panel);
    // The hold keeps a surface, which would cover the transparent surface of the swap state.
    for (const animation of from.panel.getAnimations()) animation.cancel();
    from.panel.dataset.menuSwapOut = "";
    const large = from.own && largeResize(before, after);

    const move = panel.animate(
      [
        { transform: translate(before, after), ...size(before), ...oldSurface },
        { transform: "none", ...size(after), ...newSurface },
      ],
      timing,
    );
    moves.set(panel, {
      from: before,
      to: after,
      animation: move,
      large,
      surfaces: [oldSurface, newSurface],
    });
    // The panel clips its content while its size changes, and can scroll again after the move.
    panel.dataset.menuMoving = "";
    const moved = () => panel.removeAttribute("data-menu-moving");
    move.onfinish = moved;
    move.oncancel = moved;
    // Kobalte places the panel again when its size changes. A panel aligned to the end or the center
    // of its trigger then moves on each frame and stops at a place for a height it does not have.
    // The positioner keeps the height of the panel at its new place.
    const height = `${after.height}px`;
    positionerOf(panel)?.animate([{ height }, { height }], timing);
    for (const [index, item] of Array.from(panel.children).entries()) {
      const width = itemWidth(from, widths[index]);
      const hidden = { opacity: 0, filter: SWAP_BLUR, ...width };
      item.animate(
        [
          hidden,
          ...(large ? [{ ...hidden, offset: LARGE_RESIZE_IN_START }] : []),
          { opacity: 1, filter: "blur(0px)", ...width },
        ],
        timing,
      );
    }

    const outgoing = from.panel.animate(
      [
        { transform: translate(before, natural), ...size(before) },
        { transform: translate(after, natural), ...size(after) },
      ],
      { ...timing, fill: "forwards" },
    );
    outgoing.onfinish = () => from.copy.remove();
    outgoing.oncancel = () => from.copy.remove();
    for (const [index, item] of Array.from(from.panel.children).entries()) {
      const width = itemWidth(from, oldWidths[index]);
      item.animate(
        [
          { opacity: from.moving?.itemOpacity ?? 1, filter: "blur(0px)", ...width },
          {
            opacity: 0,
            filter: SWAP_BLUR,
            ...width,
            ...(large ? { offset: LARGE_RESIZE_OUT_END } : {}),
          },
          ...(large ? [{ opacity: 0, filter: SWAP_BLUR, ...width }] : []),
        ],
        { ...timing, fill: "forwards" },
      );
    }
  });
}

function tooltipPlace(panel: HTMLElement): MotionPlace | undefined {
  if (!panel.id) return undefined;
  const owner = panel.dataset.openbotTooltipOwner;
  const trigger = document.querySelector<HTMLElement>(
    owner
      ? `[data-openbot-tooltip-trigger="${CSS.escape(owner)}"]`
      : `[aria-describedby~="${CSS.escape(panel.id)}"], [aria-labelledby~="${CSS.escape(panel.id)}"]`,
  );
  const group = trigger?.parentElement;
  return trigger && group ? { trigger, group } : undefined;
}

/** Observes Base UI's open attribute; React teardown releases frames, observers and pending entries. */
function attachMenuMotion(panel: HTMLElement, tooltip: boolean): () => void {
  let wasOpen = false;
  let own: MotionPlace | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelEntry = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    if (unmatched?.panel === panel) unmatched = undefined;
    openInGroup.delete(panel);
  };
  const enter = () => {
    delete panel.dataset.menuOriginalClosing;
    delete panel.dataset.menuSwapIn;
    delete panel.dataset.menuHandoff;
    if (!motionAllowed(panel)) return;
    frame = requestAnimationFrame(() => {
      if (!panel.isConnected || !panel.hasAttribute("data-open")) return;
      own = tooltip ? tooltipPlace(panel) : undefined;
      const group = own?.group ?? parentMenuOf(triggerOf(panel));
      if (own) {
        if (Array.from(openInGroup.values()).includes(own.group)) panel.dataset.menuHandoff = "";
        openInGroup.set(panel, own.group);
      }
      if (held && group === held.group) {
        handOff(held, panel);
        return;
      }
      if (!group) return;
      unmatched = { panel, group, since: performance.now() };
      timer = setTimeout(() => {
        if (unmatched?.panel !== panel) return;
        unmatched = undefined;
        delete panel.dataset.menuHandoff;
      }, LATE_HANDOFF_MS);
    });
  };
  const exit = () => {
    cancelEntry();
    if (motionAllowed(panel)) leave(panel, positionerOf(panel)?.parentNode ?? null, own);
  };
  const syncOpen = () => {
    const open = panel.hasAttribute("data-open");
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) enter();
    else exit();
  };
  const observer = new MutationObserver(syncOpen);
  observer.observe(panel, { attributes: true, attributeFilter: ["data-open"] });
  syncOpen();
  return () => {
    observer.disconnect();
    if (wasOpen) exit();
    else cancelEntry();
  };
}

export function menuMotionRef(ref: Ref<HTMLDivElement> | undefined, tooltip = false) {
  return (element: HTMLDivElement | null) => {
    const refCleanup = typeof ref === "function" ? ref(element) : undefined;
    if (ref && typeof ref !== "function") ref.current = element;
    if (!element) return;
    const dispose = attachMenuMotion(element, tooltip);
    return () => {
      dispose();
      if (typeof refCleanup === "function") refCleanup();
      else if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  };
}
