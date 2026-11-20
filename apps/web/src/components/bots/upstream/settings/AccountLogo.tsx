/* oxlint-disable shadcn/no-unknown-classes -- Original OpenBot logo selectors. */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "./account-logo-shape";
import "./account-logo.css";
export function AccountLogo() {
  const element = useRef<SVGSVGElement>(null),
    clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    partyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    clicks = useRef<number[]>([]);
  const [wink, setWink] = useState(false),
    [party, setParty] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clear imperative logo reaction timers when the artwork unmounts.
  useEffect(
    () => () => {
      clearTimeout(clickTimer.current);
      clearTimeout(partyTimer.current);
    },
    [],
  );
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const position = (x: number, y: number) => {
    element.current?.style.setProperty("--app-logo-eye-x", `${x * 2.4}%`);
    element.current?.style.setProperty("--app-logo-eye-y", `${y * 1.8}%`);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (reduced() || (event.pointerType && event.pointerType !== "mouse")) return;
    const box = event.currentTarget.getBoundingClientRect();
    position(
      Math.max(-1, Math.min(1, (event.clientX - box.left - box.width / 2) / (box.width / 2))),
      Math.max(-1, Math.min(1, (event.clientY - box.top - box.height / 2) / (box.height / 2))),
    );
  };
  const react = () => {
    if (reduced()) return;
    clearTimeout(clickTimer.current);
    flushSync(() => setWink(false));
    void element.current?.getBoundingClientRect();
    flushSync(() => setWink(true));
    clickTimer.current = setTimeout(() => setWink(false), 360);
  };
  const click = () => {
    react();
    if (reduced()) return;
    const now = performance.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 900), now];
    if (clicks.current.length < 5) return;
    clicks.current = [];
    clearTimeout(partyTimer.current);
    flushSync(() => setParty(false));
    void element.current?.getBoundingClientRect();
    flushSync(() => setParty(true));
    partyTimer.current = setTimeout(() => setParty(false), 1200);
  };
  return (
    <svg
      ref={element}
      className="app-logo account-login-logo"
      data-animation="blink"
      data-click-reaction={wink ? "wink" : undefined}
      data-easter-egg={party ? "party" : undefined}
      data-interactive="true"
      data-variant="production"
      viewBox={`0 0 ${APP_LOGO_SIZE} ${APP_LOGO_SIZE}`}
      aria-label="Animate OpenBot logo"
      role="button"
      tabIndex={0}
      onClick={click}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          react();
        }
      }}
      onPointerMove={move}
      onPointerLeave={() => position(0, 0)}
    >
      <rect
        className="app-logo-background"
        width={APP_LOGO_SIZE}
        height={APP_LOGO_SIZE}
        rx={APP_LOGO_CORNER}
        ry={APP_LOGO_CORNER}
      />
      <g className="app-logo-eye-motion">
        <polyline className="app-logo-eye app-logo-eye-left" points={APP_LOGO_EYE_POINTS.left} />
      </g>
      <g className="app-logo-eye-motion">
        <polyline className="app-logo-eye app-logo-eye-right" points={APP_LOGO_EYE_POINTS.right} />
      </g>
    </svg>
  );
}
