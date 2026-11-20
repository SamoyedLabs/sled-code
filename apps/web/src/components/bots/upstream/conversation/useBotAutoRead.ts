import { useEffect, useRef, type RefObject } from "react";
import { observeResize } from "../../../../lib/observeResize";
import { useStableCallback } from "../../../../hooks/useStableCallback";

export function useBotAutoRead({
  identity,
  scroller,
  watermark,
  unread,
  enabled,
  onRead,
}: {
  identity: string;
  scroller: RefObject<HTMLElement | null>;
  watermark: string | null;
  unread: number;
  enabled: boolean;
  onRead: (through: string) => void;
}) {
  const attempted = useRef<string | null>(null);
  const read = useStableCallback((scope: string, through: string) => {
    if (scope === identity && through === watermark && enabled && unread > 0) {
      attempted.current = JSON.stringify([scope, through]);
      onRead(through);
    }
  });
  const hasUnread = unread > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read receipts follow actual viewport, focus and scroll observations; retained hidden views dispose these subscriptions.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !enabled || !hasUnread || !watermark) return;
    const key = JSON.stringify([identity, watermark]);
    let frame = 0;
    const check = () => {
      frame = 0;
      if (attempted.current === key || document.hidden || !document.hasFocus()) return;
      const rect = element.getBoundingClientRect();
      if (
        !element.getClientRects().length ||
        rect.height <= 0 ||
        rect.width <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      )
        return;
      if (element.scrollHeight - element.scrollTop - element.clientHeight > 4) return;
      // One receipt per observed tail per visit, including a refused/uncertain attempt.
      read(identity, watermark);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    element.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("focus", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    const unobserve = observeResize(element, schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      unobserve();
      element.removeEventListener("scroll", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [identity, scroller, watermark, hasUnread, enabled, read]);
}
