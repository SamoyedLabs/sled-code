/* oxlint-disable shadcn/no-unknown-classes -- The OpenBot recording morph is styled by bot-conversation.css imported by its owning conversation. */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MacVoiceSession } from "../../voice-input/MacVoiceSession";
import { useStableCallback } from "../../hooks/useStableCallback";
import { CheckIcon, LoaderCircleIcon, MicIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
export function useBotDictation(ownerKey: string, text: string, commit: (text: string) => void) {
  const readDraft = useStableCallback(() => ({
    ownerKey,
    text,
    selection: { start: text.length, end: text.length },
    revision: 0,
  }));
  const commitDraft = useStableCallback(commit);
  const [session] = useState(
    () => new MacVoiceSession(window.desktopBridge?.voiceInput, readDraft, commitDraft),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- native event subscription cancels recording when this destination unmounts
  useEffect(() => session.connect(ownerKey), [session, ownerKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- external native voice session must observe every local draft revision, including change-and-restore
  useEffect(() => {
    session.observeDraft();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A local text revision must invalidate a native transcript even when the stable callback identity is unchanged.
  }, [session, text]);
  return {
    ...state,
    audio: session.audio,
    busy: ["preparing", "recording", "transcribing"].includes(state.phase),
    start: () => void session.start(),
    stop: session.stop,
    cancel: session.cancel,
  };
}
export function BotDictation({
  voice,
  disabled,
  compact = false,
  send,
}: {
  voice: ReturnType<typeof useBotDictation>;
  disabled: boolean;
  compact?: boolean;
  send?: ReactNode;
}) {
  if (!voice.available) return send ?? null;
  if (compact) return <CompactDictation voice={voice} disabled={disabled} send={send} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!voice.busy && (
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon-sm" : "default"}
          aria-label="Dictate message"
          disabled={disabled}
          onClick={voice.start}
        >
          {compact ? <MicIcon /> : "Dictate message"}
        </Button>
      )}
      {voice.phase === "recording" && (
        <Button type="button" onClick={voice.stop}>
          Stop and transcribe
        </Button>
      )}
      {(voice.busy || voice.error) && (
        <Button type="button" variant="outline" onClick={voice.cancel}>
          {voice.error ? "Dismiss dictation error" : "Cancel dictation"}
        </Button>
      )}
      {(voice.busy || voice.error) && (
        <p role="status">
          {voice.error ??
            (voice.phase === "recording"
              ? "Recording on your Mac…"
              : voice.phase === "preparing"
                ? "Preparing local dictation…"
                : "Transcribing on your Mac…")}
        </p>
      )}
    </div>
  );
}

/** React port of OpenBot VoiceRecordingMorph; the native T3 session supplies real meter levels. */
function CompactDictation({
  voice,
  disabled,
  send,
}: {
  voice: ReturnType<typeof useBotDictation>;
  disabled: boolean;
  send?: ReactNode;
}) {
  const filterId = `ob-chat-voice-${useId().replaceAll(":", "")}`;
  const levels = useSyncExternalStore(voice.audio.subscribe, voice.audio.getSnapshot);
  const track = useRef<HTMLSpanElement>(null);
  const lastUpdate = useRef(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Animate the native audio meter's newest sample with OpenBot's measured inter-sample duration.
  useEffect(() => {
    const now = performance.now();
    const interval = now - lastUpdate.current;
    lastUpdate.current = now;
    const node = track.current;
    const [first, second] = node?.children ?? [];
    if (
      !node ||
      !(first instanceof HTMLElement) ||
      !(second instanceof HTMLElement) ||
      interval > 500 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animation = node.animate(
      [
        { transform: `translateX(${second.offsetLeft - first.offsetLeft}px)` },
        { transform: "none" },
      ],
      { duration: interval },
    );
    return () => animation.cancel();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The meter data changes the rendered DOM; its revision triggers the source waveform translation after commit.
  }, [levels]);
  const recording = voice.phase === "recording";
  const label =
    voice.phase === "preparing"
      ? "Preparing local dictation…"
      : voice.phase === "transcribing"
        ? "Transcribing on your Mac…"
        : "Dictate message";
  return (
    <>
      <div className="ob-chat-voice-morph" data-recording={recording ? "" : undefined}>
        <svg className="ob-chat-voice-morph-filter" aria-hidden="true">
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
            />
          </filter>
        </svg>
        <span
          className="ob-chat-voice-morph-goo ob-chat-voice-morph-goo-bar"
          style={{ filter: `url(#${filterId})` }}
          aria-hidden="true"
        >
          <span className="ob-chat-voice-morph-bar" />
        </span>
        <span
          className="ob-chat-voice-morph-goo ob-chat-voice-morph-goo-light"
          style={{ filter: `url(#${filterId})` }}
          aria-hidden="true"
        >
          <span className="ob-chat-voice-morph-send-blob" />
          <span className="ob-chat-voice-morph-finish-blob" />
        </span>
        <div className="ob-chat-voice-morph-slot">
          {recording ? (
            <fieldset className="ob-chat-voice-recording-status" aria-label="Recording on your Mac">
              <span className="ob-chat-voice-waveform" aria-hidden="true">
                <span ref={track} className="ob-chat-voice-waveform-track">
                  {levels.map((level, index) => (
                    <span
                      // oxlint-disable-next-line react/no-array-index-key -- A fixed meter slot keeps its DOM identity while the audio history shifts, matching the upstream unkeyed waveform.
                      key={index}
                      className="ob-chat-voice-waveform-dot"
                      style={{ height: `${3 + level * 15}px` }}
                    />
                  ))}
                </span>
              </span>
              <button
                type="button"
                className="ob-chat-voice-recording-cancel"
                aria-label="Cancel dictation"
                onClick={voice.cancel}
              >
                <XIcon />
              </button>
              <button
                type="button"
                className="ob-chat-voice-recording-finish"
                aria-label="Stop and transcribe"
                onClick={voice.stop}
              >
                <CheckIcon />
              </button>
            </fieldset>
          ) : (
            <button
              type="button"
              className="ob-chat-dictation-button"
              aria-label={label}
              disabled={disabled || voice.busy}
              onClick={voice.start}
            >
              {voice.busy ? <LoaderCircleIcon className="ob-chat-spinner" /> : <MicIcon />}
            </button>
          )}
        </div>
        <span className="ob-chat-voice-morph-send">{send}</span>
      </div>
      {(voice.error || (voice.busy && !recording)) && (
        <div className="ob-chat-voice-notice" role="status">
          {voice.error ?? label}
          <button
            type="button"
            className="ob-chat-action-button"
            aria-label={voice.error ? "Dismiss dictation error" : "Cancel dictation"}
            onClick={voice.cancel}
          >
            <XIcon />
          </button>
        </div>
      )}
    </>
  );
}
