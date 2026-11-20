import { createBoundedDragPreview } from "./openbotSidebarDragPreview";
import type { SidebarDragPoint } from "./openbotSidebarDrag";

// Source createSidebarDragEngine.ts: 40px edge band, 12px/frame cap, 700ms spring-open.
export function sidebarDragScrollSpeed(top: number, bottom: number, clientY: number): number {
  const edgeSize = Math.min(40, (bottom - top) / 4);
  if (edgeSize <= 0) return 0;
  if (clientY < top + edgeSize)
    return -Math.min(12, Math.ceil(((top + edgeSize - clientY) / edgeSize) * 12));
  if (clientY > bottom - edgeSize)
    return Math.min(12, Math.ceil(((clientY - (bottom - edgeSize)) / edgeSize) * 12));
  return 0;
}
export function createSidebarDragMotion() {
  const preview = createBoundedDragPreview();
  let list: HTMLElement | null = null;
  let bounds: DOMRect | null = null;
  let point: SidebarDragPoint | null = null;
  let frame: number | null = null;
  let speed = 0;
  let resolve: ((point: SidebarDragPoint) => void) | null = null;
  let spring: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const stopSpring = () => {
    if (spring) clearTimeout(spring.timer);
    spring = null;
  };
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    speed = 0;
    list = null;
    point = null;
    bounds = null;
    resolve = null;
    stopSpring();
    preview.stop();
    window.removeEventListener("blur", stop);
  };
  const scroll = () => {
    frame = null;
    if (!list || !point || speed === 0) return;
    const before = list.scrollTop;
    list.scrollTop += speed;
    if (list.scrollTop === before) {
      speed = 0;
      return;
    }
    resolve?.(point);
    frame = requestAnimationFrame(scroll);
  };
  return {
    start(options: Parameters<typeof preview.start>[0]) {
      stop();
      list = options.bounds;
      bounds = list.getBoundingClientRect();
      preview.start(options);
      window.addEventListener("blur", stop, { once: true });
    },
    update(next: SidebarDragPoint, onResolve: (point: SidebarDragPoint) => void) {
      point = next;
      resolve = onResolve;
      preview.move(next.clientX, next.clientY);
      if (!bounds) return;
      speed = sidebarDragScrollSpeed(bounds.top, bounds.bottom, next.clientY);
      if (speed !== 0 && frame === null) frame = requestAnimationFrame(scroll);
      else if (speed === 0 && frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    },
    springOpen(id: string | null, open: (id: string) => void) {
      if (spring?.id === id) return;
      stopSpring();
      if (id)
        spring = {
          id,
          timer: setTimeout(() => {
            spring = null;
            if (list) open(id);
          }, 700),
        };
    },
    stop,
  };
}
