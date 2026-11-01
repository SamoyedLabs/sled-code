import { useEffect, useState, useSyncExternalStore } from "react";
import type { VoiceDraftSnapshot } from "@t3tools/client-runtime/voice-input";
import { useStableCallback } from "../hooks/useStableCallback";
import { useComposerDraftStore } from "../composerDraftStore";
import { MacVoiceSession } from "./MacVoiceSession";

export function useMacVoiceInput(input: {
  ownerKey: string;
  readDraft: () => VoiceDraftSnapshot | null;
  commit: (text: string, cursor: number) => void;
}) {
  const readDraft = useStableCallback(input.readDraft);
  const commit = useStableCallback(input.commit);
  const [session] = useState(
    () => new MacVoiceSession(window.desktopBridge?.voiceInput, readDraft, commit),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to native recording events and draft revisions; cleanup stops capture on navigation
  useEffect(() => {
    const disconnect = session.connect(input.ownerKey);
    const unsubscribe = useComposerDraftStore.subscribe(session.observeDraft);
    return () => {
      unsubscribe();
      disconnect();
    };
  }, [session, input.ownerKey]);
  return {
    ...state,
    audio: session.audio,
    busy:
      state.phase === "preparing" || state.phase === "recording" || state.phase === "transcribing",
    start: () => {
      void session.start();
    },
    stop: session.stop,
    cancel: session.cancel,
  };
}
