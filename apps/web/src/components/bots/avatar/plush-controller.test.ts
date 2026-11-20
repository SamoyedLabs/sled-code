import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createPlushController, type AvatarOptions } from "./plush-controller";
import { createPlushSvg } from "./plush-svg";
import { thinkingDots } from "./vendor/plush-felt";

vi.mock("./plush-svg", () => ({
  createPlushSvg: vi.fn(() => ({ appearance: vi.fn(), draw: vi.fn(), dispose: vi.fn() })),
}));

class AvatarControl extends EventTarget {
  keyboard = false;
  closest() {
    return this;
  }
  matches(selector: string) {
    return selector === ":focus-visible" ? this.keyboard : true;
  }
  contains(value: unknown) {
    return value === this;
  }
}
class AvatarFocusEvent extends Event {
  relatedTarget = null;
}
class AvatarDocument extends EventTarget {
  get visibilityState() {
    return "visible";
  }
}
let frameId = 0;
let timestamp = 0;
let frames: Map<number, FrameRequestCallback>;
let intersection: ((visible: boolean) => void) | undefined;
let media: EventTarget & { matches: boolean };
let cleanup: (() => void) | undefined;
const idle: AvatarOptions = { seed: "agent", hue: null, mood: "idle", workingFaces: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  frames = new Map();
  frameId = timestamp = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("window", { matchMedia: () => media, setTimeout, clearTimeout });
  vi.stubGlobal("document", new AvatarDocument());
  vi.stubGlobal("Element", AvatarControl);
  vi.stubGlobal("Node", AvatarControl);
  vi.stubGlobal("FocusEvent", AvatarFocusEvent);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersection = (isIntersecting) => callback([{ isIntersecting }]);
      }
      observe() {}
      disconnect() {
        intersection = undefined;
      }
    },
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mount(options = idle) {
  const control = new AvatarControl();
  // The renderer is mocked; this boundary supplies only the DOM interaction surface.
  const svg = control as unknown as SVGSVGElement;
  const controller = createPlushController(svg, "test-avatar", options);
  cleanup = controller.dispose;
  intersection?.(true);
  const view = vi.mocked(createPlushSvg).mock.results[0]!.value;
  return { controller, control, view };
}
function advance(count: number) {
  for (let index = 0; index < count; index++) {
    timestamp += 1000 / 60;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(timestamp));
  }
}

it("keeps resting avatars clock-free across intersection and document visibility changes", () => {
  const { view } = mount();
  for (let index = 0; index < 5; index++) {
    intersection?.(false);
    intersection?.(true);
    document.dispatchEvent(new Event("visibilitychange"));
    advance(60);
  }
  expect(frames.size).toBe(0);
  expect(view.draw).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("morphs on hover, caps sampling at 30 fps, and fully drains the return to rest", () => {
  const { control, view } = mount();
  const first = view.draw.mock.calls[0][0];
  control.dispatchEvent(new Event("pointerenter"));
  advance(60);
  expect(view.draw.mock.calls.length).toBeGreaterThan(10);
  expect(view.draw.mock.calls.length).toBeLessThanOrEqual(31);
  expect(view.draw.mock.lastCall[0].eyes).not.toEqual(first.eyes);
  control.dispatchEvent(new Event("pointerleave"));
  advance(180);
  expect(frames.size).toBe(0);
  const calls = view.draw.mock.calls.length;
  advance(180);
  expect(view.draw.mock.calls.length).toBe(calls);
});

it("freezes busy avatars and working-face timers offscreen, hidden, and with reduced motion", () => {
  const { view } = mount({ ...idle, mood: "working", workingFaces: true });
  advance(10);
  expect(frames.size).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  intersection?.(false);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  const calls = view.draw.mock.calls.length;
  advance(100);
  expect(view.draw.mock.calls.length).toBe(calls);
  intersection?.(true);
  expect(frames.size).toBe(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(1);
  media.matches = true;
  media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  media.matches = false;
  media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(1);
  cleanup?.();
  cleanup = undefined;
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores click focus, animates keyboard focus, and completes identity pops while paused", () => {
  const { control, controller, view } = mount();
  control.keyboard = false;
  control.dispatchEvent(new FocusEvent("focusin"));
  expect(frames.size).toBe(0);
  control.keyboard = true;
  control.dispatchEvent(new FocusEvent("focusin"));
  expect(frames.size).toBe(1);
  advance(20);
  control.dispatchEvent(new FocusEvent("focusout"));
  advance(180);
  expect(frames.size).toBe(0);
  controller.update({ ...idle, hue: 185 });
  expect(frames.size).toBe(1);
  expect(view.appearance).not.toHaveBeenCalled();
  advance(180);
  expect(view.appearance.mock.lastCall[0].color).toBe("turquoise");
  expect(view.draw.mock.lastCall[4]).toBe(1);
  expect(frames.size).toBe(0);
});

it("shows the source three-dot working decor and drains it after completion", () => {
  const { controller, view } = mount({ ...idle, mood: "working" });
  advance(30);
  const frame = view.draw.mock.lastCall;
  expect(thinkingDots(frame[2], frame[1])).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
  controller.update(idle);
  advance(180);
  const settled = view.draw.mock.lastCall;
  expect(thinkingDots(settled[2], settled[1])).toHaveLength(0);
  expect(frames.size).toBe(0);
});
