import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
} from "react";
import { observeResize } from "../../../../lib/observeResize";
export function useSuggestionScroll(
  list: RefObject<HTMLUListElement | null>,
  disabled: boolean,
  onEscape?: () => void,
) {
  const motion = useRef<{
    pointer: number | null;
    startX: number;
    startScroll: number;
    previousX: number;
    previousTime: number;
    velocity: number;
    moved: boolean;
    suppress: boolean;
    frame: number | null;
  }>({
    pointer: null,
    startX: 0,
    startScroll: 0,
    previousX: 0,
    previousTime: 0,
    velocity: 0,
    moved: false,
    suppress: false,
    frame: null,
  });
  const [fades, setFades] = useState({ back: false, forward: false }),
    [dragging, setDragging] = useState(false);
  const update = () => {
    const element = list.current;
    if (!element) return;
    const back = element.scrollLeft > 1,
      forward = element.scrollLeft < Math.max(0, element.scrollWidth - element.clientWidth) - 1;
    setFades((value) =>
      value.back === back && value.forward === forward ? value : { back, forward },
    );
  };
  const stop = () => {
    if (motion.current.frame !== null) cancelAnimationFrame(motion.current.frame);
    motion.current.frame = null;
  };
  const escape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented && !disabled && onEscape) {
      event.preventDefault();
      onEscape();
    }
  });
  const measure = useEffectEvent(update);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own source suggestion scroll measurement, finite momentum and Escape listener.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Measure real overflow after the scroll element is attached.
    measure();
    const dispose = list.current ? observeResize(list.current, () => measure()) : () => {};
    const onKey = (event: KeyboardEvent) => escape(event);
    document.addEventListener("keydown", onKey);
    return () => {
      dispose();
      document.removeEventListener("keydown", onKey);
      if (motion.current.frame !== null) cancelAnimationFrame(motion.current.frame);
      motion.current.frame = null;
    };
  }, [list]);
  const momentum = () => {
    const state = motion.current;
    if (
      !list.current ||
      Math.abs(state.velocity) < 0.01 ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    let previous = performance.now();
    const move = (now: number) => {
      const element = list.current;
      if (!element) return;
      const elapsed = Math.min(now - previous, 1000 / 30);
      previous = now;
      const before = element.scrollLeft;
      element.scrollLeft += state.velocity * elapsed;
      state.velocity *= 0.88 ** (elapsed / (1000 / 60));
      update();
      if (Math.abs(element.scrollLeft - before) >= 0.1 && Math.abs(state.velocity) >= 0.01)
        state.frame = requestAnimationFrame(move);
      else state.frame = null;
    };
    state.frame = requestAnimationFrame(move);
  };
  const down = (event: PointerEvent<HTMLUListElement>) => {
    if (disabled || event.button !== 0 || !list.current) return;
    stop();
    Object.assign(motion.current, {
      pointer: event.pointerId,
      startX: event.clientX,
      startScroll: list.current.scrollLeft,
      previousX: event.clientX,
      previousTime: event.timeStamp,
      velocity: 0,
      moved: false,
      suppress: false,
    });
  };
  const move = (event: PointerEvent<HTMLUListElement>) => {
    const state = motion.current,
      element = list.current;
    if (event.pointerId !== state.pointer || !element) return;
    const distance = event.clientX - state.startX;
    if (!state.moved && Math.abs(distance) > 8) {
      state.moved = true;
      setDragging(true);
      element.setPointerCapture(event.pointerId);
    }
    if (!state.moved) return;
    event.preventDefault();
    const elapsed = Math.max(1, event.timeStamp - state.previousTime),
      immediate = Math.max(-1.75, Math.min(1.75, (state.previousX - event.clientX) / elapsed));
    state.velocity = state.velocity * 0.65 + immediate * 0.35;
    state.previousX = event.clientX;
    state.previousTime = event.timeStamp;
    // oxlint-disable-next-line react/immutability -- Imperative scrolling changes the owned DOM element, not React data.
    element.scrollLeft = state.startScroll - distance;
    update();
  };
  const finish = (event: PointerEvent<HTMLUListElement>) => {
    const state = motion.current,
      element = list.current;
    if (event.pointerId !== state.pointer || !element) return;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    state.suppress = state.moved;
    state.pointer = null;
    state.moved = false;
    setDragging(false);
    if (state.suppress && event.type === "pointerup") momentum();
    setTimeout(() => {
      state.suppress = false;
    }, 0);
  };
  return {
    fades,
    dragging,
    onScroll: update,
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    canClick: () => !motion.current.suppress,
  };
}
