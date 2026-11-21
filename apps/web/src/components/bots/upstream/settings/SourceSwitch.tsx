import { useStableCallback } from "../../../../hooks/useStableCallback";
/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useLayoutEffect, useRef } from "react";
export function SourceSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const thumb = useRef<HTMLSpanElement>(null);
  const control = useRef<HTMLSpanElement>(null);
  const physics = useRef({ position: checked ? 1 : 0, velocity: 0, frame: 0, last: 0 });
  const drag = useRef<{
    id: number;
    start: number;
    grab: number;
    progress: number;
    moved: boolean;
  } | null>(null);
  const suppress = useRef(false);
  const target = useRef(checked ? 1 : 0);
  const paint = useStableCallback(() => {
    const current = physics.current;
    const stretch = Math.min(0.24, Math.abs(current.velocity) * 0.035);
    thumb.current?.style.setProperty("--ui-switch-position", String(current.position));
    thumb.current?.style.setProperty("--ui-switch-scale-x", String(1 + stretch));
    thumb.current?.style.setProperty("--ui-switch-scale-y", String(1 - stretch * 0.55));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The original Switch spring paints its DOM thumb independently from React renders.
  useLayoutEffect(() => {
    const current = physics.current;
    target.current = checked ? 1 : 0;
    cancelAnimationFrame(current.frame);
    current.last = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.position = target.current;
      current.velocity = 0;
      paint();
      return;
    }
    const step = (timestamp: number) => {
      const delta = Math.min((timestamp - (current.last || timestamp)) / 1000, 0.032);
      current.last = timestamp;
      current.velocity += (target.current - current.position) * 520 * delta;
      current.velocity *= Math.exp(-32 * delta);
      current.position += current.velocity * delta;
      const settled =
        Math.abs(target.current - current.position) < 0.001 && Math.abs(current.velocity) < 0.001;
      if (settled) {
        current.position = target.current;
        current.velocity = 0;
      }
      paint();
      if (!settled) current.frame = requestAnimationFrame(step);
    };
    paint();
    current.frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(current.frame);
  }, [checked, paint, physics, target]);
  const metrics = () => {
    const element = control.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const inset =
      Number.parseFloat(getComputedStyle(element).getPropertyValue("--ui-switch-inset")) || 0;
    return {
      left: rect.left,
      inset,
      travel: Math.max(1, rect.width - (thumb.current?.offsetWidth || rect.height) - inset * 2),
    };
  };
  const finish = (cancelled: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    control.current?.removeAttribute("data-dragging");
    suppress.current = !cancelled && active.moved;
    if (active.moved && !cancelled) onChange(active.progress >= 0.5);
    physics.current.position = checked ? 1 : 0;
    physics.current.velocity = 0;
    paint();
  };
  return (
    <label
      className="ui-switch"
      data-checked={checked ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <input
        className="ui-switch-input"
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        ref={control}
        className="ui-switch-control"
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return;
          event.preventDefault();
          suppress.current = false;
          const m = metrics();
          if (!m) return;
          const progress = checked ? 1 : 0;
          drag.current = {
            id: event.pointerId,
            start: event.clientX,
            grab: event.clientX - (m.left + m.inset + progress * m.travel),
            progress,
            moved: false,
          };
          cancelAnimationFrame(physics.current.frame);
          event.currentTarget.setAttribute("data-dragging", "");
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          const m = metrics();
          if (!active || active.id !== event.pointerId || !m) return;
          active.progress = Math.min(
            1,
            Math.max(0, (event.clientX - m.left - m.inset - active.grab) / m.travel),
          );
          if (Math.abs(event.clientX - active.start) >= 3) active.moved = true;
          physics.current.position = active.progress;
          physics.current.velocity = 0;
          paint();
        }}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onClick={(event) => {
          event.preventDefault();
          if (suppress.current) {
            suppress.current = false;
            return;
          }
          if (!disabled) onChange(!checked);
        }}
      >
        <span ref={thumb} className="ui-switch-thumb" data-checked={checked ? "" : undefined} />
      </span>
    </label>
  );
}
