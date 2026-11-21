import { useStableCallback } from "../../../../hooks/useStableCallback";
import { useRef } from "react";
import { observeResize } from "../../../../lib/observeResize";
export function useSourceScrollFades() {
  const content = useRef<HTMLDivElement | null>(null);
  const scroll = useStableCallback((element: HTMLElement | null) => {
    if (!element) return;
    const measure = () => {
      element.classList.toggle("scroll-fade-top", element.scrollTop > 2);
      element.classList.toggle(
        "scroll-fade-bottom",
        element.scrollTop + element.clientHeight < element.scrollHeight - 2,
      );
    };
    const stop = observeResize([element, ...(content.current ? [content.current] : [])], measure);
    const observer = new MutationObserver(measure);
    observer.observe(element, { childList: true, subtree: true });
    element.addEventListener("scroll", measure);
    measure();
    return () => {
      stop();
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  });
  return { scroll, content };
}
