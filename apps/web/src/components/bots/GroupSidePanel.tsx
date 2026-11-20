/* oxlint-disable shadcn/no-unknown-classes -- OpenBot PanelResizer geometry is scoped in group-conversation.css. */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { observeResize } from "../../lib/observeResize";
import { clampGroupPanelWidth, groupPanelBounds, groupPanelKeyWidth } from "./group-panel-width";

export function GroupSidePanel({
  settings,
  label,
  children,
}: {
  settings: boolean;
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLHRElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const width = useRef(360);
  const bounds = useRef(groupPanelBounds(456, settings));
  const [shown, setShown] = useState({ width: 360, max: 360 });
  const storageKey = settings ? "openbot:settings-panel-width" : "openbot:browser-panel-width";
  const paint = (next: number) => {
    width.current = clampGroupPanelWidth(next, bounds.current);
    panel.current?.style.setProperty("--ob-group-panel-width", `${width.current}px`);
    handle.current?.setAttribute("aria-valuenow", String(width.current));
    handle.current?.setAttribute("aria-valuetext", `${width.current}px`);
  };
  const commit = () => {
    setShown({ width: width.current, max: bounds.current.max });
    try {
      window.localStorage.setItem(storageKey, String(width.current));
    } catch {
      /* Storage may be unavailable in a private window. */
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Measure the external host, restore the source width preference, and own pointer/resize cleanup.
  useLayoutEffect(() => {
    const host = panel.current?.parentElement;
    if (!host) return;
    bounds.current = groupPanelBounds(host.clientWidth || window.innerWidth, settings);
    let saved = Number.NaN;
    try {
      saved = Number.parseFloat(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      /* Use the source default without storage. */
    }
    paint(Number.isFinite(saved) ? saved : bounds.current.defaultValue);
    setShown({ width: width.current, max: bounds.current.max });
    const resize = () => {
      bounds.current = groupPanelBounds(host.clientWidth || window.innerWidth, settings);
      const previous = width.current;
      paint(previous);
      setShown({ width: width.current, max: bounds.current.max });
      if (width.current !== previous) commit();
    };
    const stop = observeResize(host, resize);
    window.addEventListener("resize", resize);
    return () => {
      cancel.current?.();
      stop();
      window.removeEventListener("resize", resize);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Changing panel type selects its separate source storage key and width bounds; methods use stable DOM refs.
  }, [settings, storageKey]);
  return (
    <aside ref={panel} id={id} className="ob-group-side-panel" aria-label={label}>
      <hr
        ref={handle}
        className="ob-group-panel-resizer"
        tabIndex={0}
        aria-label="Resize group panel"
        aria-controls={id}
        aria-orientation="vertical"
        aria-valuemin={settings ? 360 : 220}
        aria-valuemax={shown.max}
        aria-valuenow={shown.width}
        aria-valuetext={`${shown.width}px`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          cancel.current?.();
          const target = event.currentTarget;
          const pointerId = event.pointerId;
          const start = event.clientX;
          const initial = width.current;
          const rtl = getComputedStyle(target).direction === "rtl";
          let delta = 0;
          target.setPointerCapture?.(pointerId);
          target.dataset.dragging = "";
          document.documentElement.classList.add("ob-group-panel-resizing");
          const move = (pointer: PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            delta = pointer.clientX - start;
            paint(initial + (rtl ? delta : -delta));
          };
          const finish = (pointer?: PointerEvent) => {
            if (pointer && pointer.pointerId !== pointerId) return;
            if (pointer) {
              delta = pointer.clientX - start;
              paint(initial + (rtl ? delta : -delta));
            }
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", stop);
            window.removeEventListener("blur", stop);
            delete target.dataset.dragging;
            document.documentElement.classList.remove("ob-group-panel-resizing");
            if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
            cancel.current = null;
            commit();
          };
          const stop = () => finish();
          cancel.current = stop;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", finish);
          window.addEventListener("pointercancel", stop);
          window.addEventListener("blur", stop);
        }}
        onKeyDown={(event) => {
          const next = groupPanelKeyWidth(
            event.key,
            width.current,
            bounds.current,
            getComputedStyle(event.currentTarget).direction === "rtl",
          );
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          paint(next);
          commit();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          paint(bounds.current.defaultValue);
          commit();
        }}
      />
      {children}
    </aside>
  );
}
