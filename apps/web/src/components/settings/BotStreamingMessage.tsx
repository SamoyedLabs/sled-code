/* oxlint-disable shadcn/no-unknown-classes -- These scoped classes port the OpenBot message-content resize surface. */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { parseBotSelectionInstruction } from "./botSelectionModel";
import { BotChatMarkdown } from "../bots/BotChatMarkdown";
import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { botStreamingTrailPlugin, type BotStreamingChunk } from "./botStreamingTrail";
import { nextBotStreamingReveal } from "./botStreamingReveal";

type Props = ComponentProps<typeof BotChatMarkdown> & {
  onLayout: () => void;
  selectionMessageId?: string | undefined;
  selectionInstruction?: boolean;
};

/** React port of MessageRendering.createStreamingBody and createSmoothHeightResize.
 * The existing markdown renderer retains T3's host-scoped links and code/file actions.
 */
export function BotStreamingMessage({
  text,
  isStreaming,
  onLayout,
  selectionMessageId,
  selectionInstruction,
  ...props
}: Props) {
  const [shown, setShown] = useState(text);
  const [trail, setTrail] = useState<BotStreamingChunk[]>([]);
  const model = useRef({
    target: text,
    shown: text,
    streaming: Boolean(isStreaming),
    active: Boolean(isStreaming),
    budget: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const notifyLayout = useStableCallback(onLayout);
  const timingsRead = useRef(false);
  const timings = useRef({
    stepMs: 40,
    catchUpMs: 400,
    fadeMs: 300,
    duration: 240,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source reveal clock projects incoming provider text into word-boundary display steps, independently of network arrival frequency.
  useEffect(() => {
    const state = model.current;
    state.target = text;
    state.streaming = Boolean(isStreaming);
    if (isStreaming) state.active = true;
    if (!timingsRead.current) {
      const style = container.current ? getComputedStyle(container.current) : undefined;
      const duration = (name: string, fallback: number) => {
        const value = style?.getPropertyValue(name).trim();
        const number = Number.parseFloat(value ?? "");
        return Number.isFinite(number) ? number * (value?.endsWith("ms") ? 1 : 1000) : fallback;
      };
      timings.current = {
        stepMs: Math.max(16, duration("--stream-gap", 40)),
        catchUpMs: duration("--stream-catch-up", 400),
        fadeMs: duration("--stream-fade", 300),
        duration: duration("--openbot-duration-overlay", 240),
        easing:
          style?.getPropertyValue("--openbot-ease-out").trim() || "cubic-bezier(0.23, 1, 0.32, 1)",
      };
      timingsRead.current = true;
    }
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !text.startsWith(state.shown) ||
      (!isStreaming && !state.active)
    ) {
      clearTimeout(state.timer);
      state.timer = undefined;
      state.budget = 0;
      state.shown = text;
      state.active = false;
      setShown(text);
      setTrail((current) => (current.length ? [] : current));
      return;
    }
    const schedule = () => {
      if (state.timer !== undefined || state.shown === state.target) return;
      state.timer = setTimeout(() => {
        state.timer = undefined;
        const step = nextBotStreamingReveal({
          shownLength: state.shown.length,
          target: state.target,
          streaming: state.streaming,
          budget: state.budget,
          ...timings.current,
        });
        state.budget = step.budget;
        const advanced = step.length > state.shown.length;
        if (advanced) {
          const now = performance.now();
          const length = step.length - state.shown.length;
          setTrail((previous) => [
            ...previous.filter((chunk) => now - chunk.revealedAt < timings.current.fadeMs),
            { length, revealedAt: now },
          ]);
          state.shown = state.target.slice(0, step.length);
          setShown(state.shown);
        }
        if (state.shown !== state.target) {
          if (advanced || state.budget < 0) schedule();
        } else if (!state.streaming) state.active = false;
      }, timings.current.stepMs);
    };
    schedule();
  }, [text, isStreaming]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Dispose the external reveal clock when this identity-scoped message leaves the conversation.
  useEffect(
    () => () => {
      clearTimeout(model.current.timer);
      model.current.timer = undefined;
    },
    [],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe rendered markdown height, using the upstream interruption-safe resize animation and keeping the reader's scroll anchor current.
  useLayoutEffect(() => {
    const outer = container.current;
    const inner = content.current;
    if (!outer || !inner) return;
    let animation: Animation | undefined;
    let previousHeight: number | undefined;
    const disconnect = observeResize(inner, () => {
      const height = inner.getBoundingClientRect().height;
      const previous = previousHeight;
      previousHeight = height;
      if (
        previous !== undefined &&
        previous !== height &&
        (model.current.active || model.current.streaming) &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        const measured = Number.parseFloat(getComputedStyle(outer).height);
        const start = animation && Number.isFinite(measured) ? measured : previous;
        animation?.cancel();
        outer.setAttribute("data-resizing", "true");
        const current = outer.animate([{ height: `${start}px` }, { height: `${height}px` }], {
          duration: timings.current.duration,
          easing: timings.current.easing,
        });
        animation = current;
        void current.finished.then(
          () => {
            if (animation === current) {
              animation = undefined;
              outer.removeAttribute("data-resizing");
              notifyLayout();
            }
          },
          () => undefined,
        );
      }
      notifyLayout();
    });
    return () => {
      disconnect();
      animation?.cancel();
    };
  }, [notifyLayout]);

  // A host correction replaces the projection immediately, as in the source's body memo.
  const body = text.startsWith(shown) ? shown : text;
  const selectedInstruction = selectionInstruction ? parseBotSelectionInstruction(body) : null;
  const plugins = trail.length
    ? [botStreamingTrailPlugin(body, trail, trail.at(-1)!.revealedAt)]
    : [];
  return (
    <div ref={container} className="ob-chat-content-resize">
      <div data-selection-message-id={selectionMessageId} ref={content}>
        <BotChatMarkdown
          {...props}
          extraRemarkPlugins={plugins}
          text={selectedInstruction?.instruction ?? body}
          isStreaming={isStreaming || body !== text}
        />
        {selectedInstruction && (
          <blockquote className="ob-chat-selection-quote">{selectedInstruction.quote}</blockquote>
        )}
      </div>
    </div>
  );
}
