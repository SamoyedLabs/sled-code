/* oxlint-disable shadcn/no-unknown-classes -- The scoped opacity-only tail animation is defined in PreviewStreamingText.css. */
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { nextBotStreamingReveal } from "../settings/botStreamingReveal";
import { splitBotStreamingTrail, type BotStreamingChunk } from "../settings/botStreamingTrail";
import "./PreviewStreamingText.css";
import { BotTypingIndicator } from "./BotTypingIndicator";

const STEP_MS = 40;
const CATCH_UP_MS = 400;
const FADE_MS = 300;

/** Source word-boundary reveal, with stable settled text and a short opacity-only tail. */
export function PreviewStreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [projection, setProjection] = useState(() => ({
    text: streaming ? "" : text,
    trail: [] as BotStreamingChunk[],
  }));
  const clock = useRef({
    shown: streaming ? "" : text,
    target: text,
    streaming,
    active: streaming,
    budget: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Drive the source reveal clock independently of network chunks; it sleeps whenever its displayed buffer catches up.
  useEffect(() => {
    const state = clock.current;
    state.target = text;
    state.streaming = streaming;
    if (streaming) state.active = true;
    if (reduced || !text.startsWith(state.shown) || (!streaming && !state.active)) {
      clearTimeout(state.timer);
      state.timer = undefined;
      state.shown = text;
      state.active = false;
      state.budget = 0;
      setProjection((current) =>
        current.text === text && !current.trail.length ? current : { text, trail: [] },
      );
      return;
    }
    const schedule = () => {
      if (state.timer !== undefined || state.shown === state.target) return;
      state.timer = setTimeout(() => {
        state.timer = undefined;
        const next = nextBotStreamingReveal({
          shownLength: state.shown.length,
          target: state.target,
          streaming: state.streaming,
          budget: state.budget,
          stepMs: STEP_MS,
          catchUpMs: CATCH_UP_MS,
        });
        state.budget = next.budget;
        const length = next.length - state.shown.length;
        if (length > 0) {
          const now = performance.now();
          state.shown = state.target.slice(0, next.length);
          const shown = state.shown;
          setProjection((current) => ({
            text: shown,
            trail: [
              ...current.trail.filter((chunk) => now - chunk.revealedAt < FADE_MS),
              { length, revealedAt: now },
            ],
          }));
        }
        if (state.shown !== state.target) {
          if (length > 0 || state.budget < 0) schedule();
        } else if (!state.streaming) state.active = false;
      }, STEP_MS);
    };
    if (!streaming && state.shown === state.target) state.active = false;
    schedule();
  }, [text, streaming, reduced]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release the external reveal clock when this identity-scoped reply unmounts.
  useEffect(
    () => () => {
      clearTimeout(clock.current.timer);
      clock.current.timer = undefined;
    },
    [],
  );
  const corrected = !text.startsWith(projection.text);
  const shown = corrected ? text : projection.text;
  const trail = corrected
    ? { prefix: text, chunks: [] }
    : splitBotStreamingTrail(shown, projection.trail);
  const typing = streaming && !(reduced ? text : shown);
  return (
    <p
      data-preview-stream-text
      data-phase={typing ? "typing" : streaming ? "streaming" : "complete"}
      data-streaming={streaming || undefined}
      className="whitespace-pre-wrap break-words leading-relaxed"
    >
      {typing ? (
        <BotTypingIndicator />
      ) : reduced ? (
        text
      ) : (
        <>
          {trail.prefix}
          {trail.chunks.map((chunk) => (
            <span key={chunk.revealedAt} className="preview-stream-word">
              {chunk.text}
            </span>
          ))}
        </>
      )}
    </p>
  );
}
