import { randomUUID } from "expo-crypto";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Keyboard } from "react-native";
import type {
  OpenbotChannelMessage,
  OpenbotChannelTask,
  OpenbotConversationMessage,
  OpenbotQueueDelivery,
} from "@t3tools/contracts";
import { useAppForeground } from "../../../../lib/appState";
import { useBotMessageReading } from "./BotMessageReading";
import { getBotSpeechTranscriber, useBotRecognition } from "./botRecognition";
import { botElevenLabsScribeToken, useBotElevenLabs } from "./botElevenLabs";
import { ScribeRealtimeSession } from "./scribe-realtime";
import { getBotTurnPause } from "./botTurnPause";
import { speechNative } from "./speech-native";
import { transcribeBotVoiceServerPcm, useBotVoiceServer } from "./botVoiceServer";
import { useGT } from "gt-react-native";

const MAX_CAPTURE_BYTES = 2 * 60 * 16_000 * 2;

async function requestRecordingPermission() {
  const audio = await import("expo-audio");
  return audio.requestRecordingPermissionsAsync();
}

type Phase =
  | "starting"
  | "listening"
  | "transcribing"
  | "sending"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";
type State = { phase: Phase; caption: string; retry?: boolean };
type Run = {
  abort: AbortController;
  capture: { remove: () => void }[];
  scribe: ScribeRealtimeSession | null;
  timer: ReturnType<typeof setTimeout> | null;
  heard: string[];
  hasSpoken: boolean;
  finalizing: boolean;
  messageId: string | null;
  turnId: string | null;
  interruptible: boolean;
  reading: ReturnType<ReturnType<typeof useBotMessageReading>["stream"]>;
  replyText: string;
  pending: { text: string; operationId: string } | null;
};

export type BotVoiceReply = {
  turnId: string | null;
  interruptible: boolean;
  failed: boolean;
  complete: boolean;
  text: string;
};

const nonSpokenItems = new Set([
  "commentary",
  "question_prompt",
  "plan",
  "subagents",
  "memory-changes",
  "routine_quiet_answer",
]);

function isVoiceAnswer(message: OpenbotConversationMessage) {
  return (
    (message.author === "agent" || message.author === "assistant") &&
    !nonSpokenItems.has(message.itemType ?? "") &&
    (message.status === "completed" || message.status === "streaming") &&
    Boolean(message.text.trim())
  );
}

export function directBotVoiceReply(
  messageId: string,
  messages: readonly OpenbotConversationMessage[],
  deliveries: readonly OpenbotQueueDelivery[],
  activeTurnId: string | null,
): BotVoiceReply {
  const message = messages.find(
    (item) => item.id === messageId || item.clientMessageId === messageId,
  );
  const delivery = deliveries.find((item) => item.messageId === (message?.id ?? messageId));
  const turnId = message?.turnId ?? delivery?.turnId ?? null;
  const interruptible = turnId !== null && turnId === activeTurnId;
  const failed = Boolean(
    delivery && ["failed", "cancelled", "interrupted"].includes(delivery.status),
  );
  const replies = turnId
    ? messages.filter((item) => item.turnId === turnId && isVoiceAnswer(item))
    : [];
  const complete = Boolean(
    turnId &&
    !interruptible &&
    replies.length &&
    replies.every((item) => item.status === "completed"),
  );
  return {
    turnId,
    interruptible,
    failed,
    complete,
    text: replies
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function groupBotVoiceReply(
  receiptId: string,
  messages: readonly OpenbotChannelMessage[],
  tasks: readonly OpenbotChannelTask[],
): BotVoiceReply {
  const source = messages.find((entry) => entry.id === receiptId || entry.message.id === receiptId);
  const root = tasks.find(
    (task) =>
      task.parentTaskId === null &&
      (task.requestMessageId === receiptId ||
        task.requestMessageId === source?.id ||
        task.requestMessageId === source?.message.id),
  );
  const related = root
    ? tasks.filter((task) => task.id === root.id || task.rootTaskId === root.id)
    : [];
  const running = related.find((task) => task.state === "running" || task.state === "queued");
  const waiting =
    running || related.some((task) => task.state === "waiting" || task.state === "paused");
  const failed = root?.state === "failed" || root?.state === "cancelled";
  const ownTasks = new Set(
    related
      .filter((task) => task.state === "running" || task.state === "completed")
      .map((task) => task.id),
  );
  const replies = messages.filter(
    (entry) =>
      entry.taskId !== null &&
      ownTasks.has(entry.taskId) &&
      entry.author.kind === "agent" &&
      isVoiceAnswer(entry.message) &&
      !entry.superseded,
  );
  return {
    turnId: running?.id ?? root?.id ?? null,
    interruptible: Boolean(running),
    failed,
    complete: Boolean(
      root &&
      !waiting &&
      replies.length &&
      replies.every(({ message }) => message.status === "completed"),
    ),
    text: replies
      .map(({ message }) => message.text)
      .filter(Boolean)
      .join("\n\n"),
  };
}

type Input = {
  visible: boolean;
  available: boolean;
  scope: string;
  replyFor: (messageId: string) => BotVoiceReply;
  send: (text: string, id: string) => Promise<string | null>;
  interrupt: (turnId: string) => Promise<boolean>;
};

function clearCapture(run: Run) {
  if (run.timer !== null) clearTimeout(run.timer);
  run.timer = null;
  for (const listener of run.capture.splice(0)) listener.remove();
}

export function useBotLiveVoice(input: Input) {
  const gt = useGT();
  const [state, setState] = useState<State | null>(null);
  const run = useRef<Run | null>(null);
  const foreground = useAppForeground();
  const selected = useBotRecognition();
  const voiceServer = useBotVoiceServer();
  const elevenLabs = useBotElevenLabs();
  const remoteListening = selected === "voice-server";
  const scribeListening = selected === "elevenlabs";
  const audioStreaming = remoteListening || scribeListening;
  const reading = useBotMessageReading(input.scope + "/continuous");
  const native = speechNative;
  const available =
    input.available &&
    foreground &&
    selected !== "device" &&
    (!remoteListening || Boolean(voiceServer?.routes.dictation)) &&
    (!scribeListening || elevenLabs !== null) &&
    Boolean(native?.startCapture);
  const active = useRef(input);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps live voice async callbacks reading the latest hook inputs.
  useEffect(() => {
    active.current = input;
  }, [input]);

  const end = () => {
    const current = run.current;
    if (!current) return;
    run.current = null;
    current.abort.abort();
    current.scribe?.cancel();
    clearCapture(current);
    native?.cancelCapture?.();
    if (current.reading) reading.stop();
    setState(null);
  };
  const report = (caption: string) => setState({ phase: "error", caption });
  async function sendTurn(current: Run) {
    const pending = current.pending;
    if (!pending || run.current !== current || !active.current.visible) return;
    setState({ phase: "sending", caption: pending.text });
    const messageId = await active.current
      .send(pending.text, pending.operationId)
      .catch(() => null);
    if (run.current !== current) return;
    if (messageId) {
      current.pending = null;
      current.messageId = messageId;
      setState({ phase: "thinking", caption: pending.text });
    } else
      setState({
        phase: "error",
        caption: gt("Could not confirm that the voice message was sent."),
        retry: true,
      });
  }

  const listenRef = useRef<(current: Run) => Promise<void>>(async () => {});
  const listen = async (current: Run) => {
    if (run.current !== current || !native?.startCapture || !active.current.visible) return;
    current.heard = [];
    current.hasSpoken = false;
    current.finalizing = false;
    current.messageId = null;
    current.turnId = null;
    current.interruptible = false;
    current.reading = null;
    current.replyText = "";
    setState({ phase: "starting", caption: "" });
    clearCapture(current);
    current.scribe?.cancel();
    current.scribe = null;
    if (scribeListening) {
      let token: string;
      try {
        token = await botElevenLabsScribeToken(current.abort.signal);
      } catch {
        if (run.current === current) report("Could not start ElevenLabs dictation.");
        return;
      }
      if (run.current !== current) return;
      current.scribe = new ScribeRealtimeSession({
        token,
        onText: (text) => {
          if (run.current === current && !current.finalizing)
            setState({ phase: "listening", caption: text });
        },
        onFailure: () => {
          if (run.current !== current) return;
          current.scribe = null;
          clearCapture(current);
          native.cancelCapture?.();
          report("ElevenLabs could not recognize this recording.");
        },
      });
    }
    const audio: Uint8Array[] = [];
    const turnPause = getBotTurnPause();
    let capturedBytes = 0;
    if (audioStreaming)
      current.capture.push(
        native.addListener("onCaptureAudio", ({ pcm }) => {
          if (run.current !== current || current.finalizing || pcm.length > 16_384) return;
          if (scribeListening) {
            capturedBytes += Math.floor(pcm.length * 0.75);
            if (capturedBytes > MAX_CAPTURE_BYTES) {
              current.finalizing = true;
              native.finishCapture?.();
              return;
            }
            current.scribe?.append(pcm);
            return;
          }
          let chunk: Uint8Array;
          try {
            chunk = Uint8Array.from(atob(pcm), (byte) => byte.charCodeAt(0));
          } catch {
            clearCapture(current);
            native.cancelCapture?.();
            report("The microphone returned unreadable audio.");
            return;
          }
          if (!chunk.length || chunk.length % 2) return;
          if (capturedBytes + chunk.length > MAX_CAPTURE_BYTES) {
            current.finalizing = true;
            native.finishCapture?.();
            return;
          }
          audio.push(chunk);
          capturedBytes += chunk.byteLength;
        }),
      );
    current.capture.push(
      native.addListener("onCaptureText", ({ text, final }) => {
        if (run.current !== current || audioStreaming || !text.trim()) return;
        if (final) current.heard.push(text.trim());
        setState({
          phase: "listening",
          caption: [...current.heard, ...(final ? [] : [text])].join(" "),
        });
      }),
      native.addListener("onCaptureLevel", ({ speaking }) => {
        if (run.current !== current || current.finalizing) return;
        if (speaking) {
          current.hasSpoken = true;
          if (current.timer !== null) clearTimeout(current.timer);
          current.timer = null;
          return;
        }
        if (!current.hasSpoken || current.timer !== null) return;
        current.timer = setTimeout(() => {
          current.finalizing = true;
          native.finishCapture?.();
        }, turnPause);
      }),
      native.addListener("onCaptureEnd", ({ error }) => {
        if (run.current !== current) return;
        clearCapture(current);
        if (error) {
          current.scribe?.cancel();
          current.scribe = null;
          report("The microphone was interrupted.");
          return;
        }
        const finish = async () => {
          let text = current.heard.join(" ").trim();
          if (remoteListening && current.hasSpoken && capturedBytes) {
            setState({ phase: "transcribing", caption: "" });
            text = await transcribeBotVoiceServerPcm(audio, capturedBytes, current.abort.signal);
          }
          if (scribeListening && current.scribe) {
            const scribe = current.scribe;
            setState({ phase: "transcribing", caption: scribe.text });
            await scribe.finish();
            if (current.scribe !== scribe) return;
            current.scribe = null;
            text = scribe.text.trim();
          }
          if (run.current !== current) return;
          if (!text) {
            void listenRef.current(current);
            return;
          }
          current.pending = { text, operationId: randomUUID() };
          void sendTurn(current);
        };
        void finish().catch(() => {
          if (run.current === current)
            report("The voice server could not transcribe this recording.");
        });
      }),
    );
    const captureMode = audioStreaming ? "stream" : "transcribe";
    try {
      await native.startCapture(captureMode);
      if (run.current === current) setState({ phase: "listening", caption: gt("Speak now") });
    } catch {
      if (run.current === current) {
        clearCapture(current);
        current.scribe?.cancel();
        current.scribe = null;
        report("Could not open the microphone.");
      }
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the recursive capture-end callback pointing at the latest listen closure.
  useEffect(() => {
    listenRef.current = listen;
  });

  const start = async () => {
    if (!available || run.current) return;
    const transcriber = getBotSpeechTranscriber();
    const current: Run = {
      abort: new AbortController(),
      capture: [],
      scribe: null,
      timer: null,
      heard: [],
      hasSpoken: false,
      finalizing: false,
      messageId: null,
      turnId: null,
      interruptible: false,
      reading: null,
      replyText: "",
      pending: null,
    };
    run.current = current;
    Keyboard.dismiss();
    setState({ phase: "starting", caption: "" });
    if (!transcriber && !scribeListening) {
      report("Download and select a listening model in Bot voice settings.");
      return;
    }
    await (async () => {
      const permission = await requestRecordingPermission();
      if (run.current !== current) return;
      if (!permission.granted) {
        report("Allow microphone access in Settings to start a voice conversation.");
        return;
      }
      await transcriber?.prepare({ signal: current.abort.signal });
      if (run.current === current) await listen(current);
    })().catch(() => {
      if (run.current === current) report("Could not load the listening model.");
    });
  };

  const follow = useEffectEvent((replyFor: typeof input.replyFor, currentState: State | null) => {
    const current = run.current;
    if (
      !current ||
      !current.messageId ||
      (currentState?.phase !== "thinking" && currentState?.phase !== "speaking")
    )
      return;
    const reply = replyFor(current.messageId);
    current.turnId = reply.turnId;
    current.interruptible = reply.interruptible;
    if (reply.failed) {
      if (current.reading) reading.stop();
      report("The bot stopped before answering.");
      return;
    }
    if (reply.text) current.replyText = reply.text;
    if (!current.replyText) return;
    if (!current.reading) {
      current.reading = reading.stream(current.messageId, {
        onStart: () => {
          if (run.current === current) setState({ phase: "speaking", caption: current.replyText });
        },
        onDone: () => {
          if (run.current === current) void listen(current);
        },
        onError: () => {
          if (run.current === current) report("Could not read the reply aloud.");
        },
      });
    } else if (currentState.phase === "speaking" && currentState.caption !== current.replyText)
      setState({ phase: "speaking", caption: current.replyText });
    current.reading?.update(current.replyText, reply.complete);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Only the voice session tied to this chat may follow its own turn.
  useEffect(() => follow(input.replyFor, state), [input.replyFor, state]);
  const closeHidden = useEffectEvent(() => end());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Leaving the chat or the app immediately releases the native microphone.
  useEffect(() => {
    if (
      !input.visible ||
      !foreground ||
      selected === "device" ||
      (remoteListening && !voiceServer?.routes.dictation) ||
      (scribeListening && !elevenLabs)
    )
      closeHidden();
    return () => closeHidden();
  }, [
    input.visible,
    foreground,
    selected,
    remoteListening,
    voiceServer,
    scribeListening,
    elevenLabs,
  ]);

  return {
    available,
    state,
    start,
    end,
    retry: () => {
      if (state?.retry && run.current) void sendTurn(run.current);
    },
    mute: () => {
      const current = run.current;
      if (!current) return;
      if (state?.phase === "muted") void listen(current);
      else if (state?.phase === "listening") {
        clearCapture(current);
        current.scribe?.cancel();
        current.scribe = null;
        native?.cancelCapture?.();
        setState({ phase: "muted", caption: "" });
      }
    },
    interrupt: async () => {
      const current = run.current;
      if (!current) return;
      if (current.reading) reading.stop();
      await (async () => {
        if (current.turnId && current.interruptible) {
          const interrupted = await active.current.interrupt(current.turnId);
          if (!interrupted || run.current !== current) return;
        }
        await listen(current);
      })().catch(() => {
        if (run.current === current) report("Could not interrupt the bot.");
      });
    },
  };
}
