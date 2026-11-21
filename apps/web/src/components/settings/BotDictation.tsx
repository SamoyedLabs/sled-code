import { useEffect, useState, useSyncExternalStore } from "react";
import { MacVoiceSession } from "../../voice-input/MacVoiceSession";
import { useStableCallback } from "../../hooks/useStableCallback";

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
