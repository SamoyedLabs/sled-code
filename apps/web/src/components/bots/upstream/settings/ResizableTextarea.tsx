/* oxlint-disable shadcn/no-unknown-classes -- Original ResizableTextarea selectors are supplied by source primitives. */
import { useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
export function ResizableTextarea({
  resizeLabel,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { resizeLabel: string }) {
  const element = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ minimum: 0, initial: 0 });
  const maximum = Math.max(
    dimensions.minimum,
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const clamp = (value: number) =>
    Math.round(Math.min(maximum, Math.max(dimensions.minimum, value)));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source drag grip derives its initial and minimum sizes from the rendered textarea.
  useLayoutEffect(() => {
    if (element.current)
      setDimensions({
        minimum: Number.parseFloat(getComputedStyle(element.current).minHeight) || 0,
        initial: element.current.offsetHeight,
      });
    return () => document.documentElement.classList.remove("ui-textarea-resizing");
  }, []);
  const finish = () => {
    drag.current = null;
    document.documentElement.classList.remove("ui-textarea-resizing");
  };
  return (
    <div className="ui-textarea-resizable">
      <textarea
        {...props}
        ref={element}
        style={{ ...props.style, ...(height === undefined ? {} : { height: `${height}px` }) }}
      />
      <hr
        className="ui-textarea-resizer"
        tabIndex={0}
        aria-label={resizeLabel}
        aria-orientation="horizontal"
        aria-valuemin={dimensions.minimum}
        aria-valuemax={maximum}
        aria-valuenow={height ?? dimensions.initial}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = {
            id: event.pointerId,
            y: event.clientY,
            height: element.current?.offsetHeight ?? dimensions.initial,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          document.documentElement.classList.add("ui-textarea-resizing");
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.id === event.pointerId)
            setHeight(clamp(active.height + event.clientY - active.y));
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={(event) => {
          const current = element.current?.offsetHeight ?? height ?? dimensions.initial;
          const next =
            event.key === "ArrowDown"
              ? current + 24
              : event.key === "ArrowUp"
                ? current - 24
                : event.key === "Home"
                  ? dimensions.minimum
                  : event.key === "End"
                    ? maximum
                    : undefined;
          if (next !== undefined) {
            event.preventDefault();
            setHeight(clamp(next));
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          setHeight(undefined);
        }}
      />
    </div>
  );
}
