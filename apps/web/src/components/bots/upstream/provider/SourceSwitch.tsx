/* oxlint-disable shadcn/no-unknown-classes -- OpenBot's switch.tsx and primitives.css translated onto Base UI. */
import { Switch } from "@base-ui/react/switch";
import { useEffect, useRef, type PointerEvent } from "react";
/** The source spring (520 stiffness / 32 damping), velocity stretch and 3px drag threshold. */
export function SourceSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean | undefined;
  label: string;
}) {
  const thumb = useRef<HTMLSpanElement>(null);
  const motion = useRef({
    position: checked ? 1 : 0,
    target: checked ? 1 : 0,
    velocity: 0,
    frame: undefined as number | undefined,
    lastTimestamp: undefined as number | undefined,
  });
  const drag = useRef<{
    pointerId: number;
    grab: number;
    startClientX: number;
    progress: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const stop = () => {
    const state = motion.current;
    if (state.frame !== undefined) cancelAnimationFrame(state.frame);
    state.frame = undefined;
    state.lastTimestamp = undefined;
  };
  const paint = () => {
    const state = motion.current;
    const stretch = Math.min(0.24, Math.abs(state.velocity) * 0.035);
    thumb.current?.style.setProperty("--ui-switch-position", String(state.position));
    thumb.current?.style.setProperty("--ui-switch-scale-x", String(1 + stretch));
    thumb.current?.style.setProperty("--ui-switch-scale-y", String(1 - stretch * 0.55));
  };
  const animate = () => {
    stop();
    const state = motion.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.position = state.target;
      state.velocity = 0;
      paint();
      return;
    }
    const step = (timestamp: number) => {
      state.frame = undefined;
      const previous = state.lastTimestamp ?? timestamp;
      state.lastTimestamp = timestamp;
      const delta = Math.min((timestamp - previous) / 1000, 0.032);
      state.velocity += (state.target - state.position) * 520 * delta;
      state.velocity *= Math.exp(-32 * delta);
      state.position += state.velocity * delta;
      const settled =
        Math.abs(state.target - state.position) < 0.001 && Math.abs(state.velocity) < 0.001;
      if (settled) {
        state.position = state.target;
        state.velocity = 0;
      }
      paint();
      if (!settled) state.frame = requestAnimationFrame(step);
      else state.lastTimestamp = undefined;
    };
    state.frame = requestAnimationFrame(step);
  };
  /* oxlint-disable t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- Only a controlled checked change starts this source DOM spring; its mutable integration state stays outside React rendering. */
  useEffect(() => {
    motion.current.target = checked ? 1 : 0;
    animate();
    return stop;
  }, [checked]);
  /* oxlint-enable t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies */
  const metrics = (control: HTMLElement) => {
    const rect = control.getBoundingClientRect();
    const inset =
      Number.parseFloat(getComputedStyle(control).getPropertyValue("--ui-switch-inset")) || 0;
    const width = thumb.current?.offsetWidth ?? rect.height;
    return { left: rect.left, inset, travel: Math.max(1, rect.width - width - inset * 2) };
  };
  const update = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const box = metrics(event.currentTarget);
    active.progress = Math.min(
      1,
      Math.max(0, (event.clientX - box.left - box.inset - active.grab) / box.travel),
    );
    if (Math.abs(event.clientX - active.startClientX) >= 3) active.moved = true;
    stop();
    motion.current.position = active.progress;
    motion.current.target = active.progress;
    motion.current.velocity = 0;
    paint();
  };
  const finish = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!cancelled) update(event);
    const next = !cancelled && active.moved ? active.progress >= 0.5 : checked;
    drag.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    suppressClick.current = !cancelled && active.moved;
    if (!cancelled && active.moved) onChange(next);
    motion.current.target = next ? 1 : 0;
    animate();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <Switch.Root
      className="ui-switch"
      data-size="default"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={onChange}
      onKeyDown={(event) => event.currentTarget.removeAttribute("data-pointer-focus")}
      onBlur={(event) => event.currentTarget.removeAttribute("data-pointer-focus")}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (event.button !== 0 || disabled) return;
        event.currentTarget.setAttribute("data-pointer-focus", "");
        event.preventDefault();
        const box = metrics(event.currentTarget);
        const progress = checked ? 1 : 0;
        drag.current = {
          pointerId: event.pointerId,
          grab: event.clientX - (box.left + box.inset + progress * box.travel),
          startClientX: event.clientX,
          progress,
          moved: false,
        };
        stop();
        motion.current.position = progress;
        motion.current.target = progress;
        motion.current.velocity = 0;
        paint();
        event.currentTarget.setAttribute("data-dragging", "");
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={update}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <Switch.Thumb ref={thumb} className="ui-switch-thumb" data-slot="switch-thumb" />
    </Switch.Root>
  );
}
