import { useAtomValue } from "@effect/atom-react";
import { OPENBOT_LIVE_VOICE_CAPABILITY, type EnvironmentId } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { requestRecordingPermissionsAsync } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { useAppForeground } from "../../../../lib/appState";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { botGptVoiceNative, useBotGptVoiceSettings } from "./botGptVoice";
import type { useBotLiveVoice } from "./useBotLiveVoice";
import { useGT } from "gt-react-native";

type State = NonNullable<ReturnType<typeof useBotLiveVoice>["state"]>;
type CallLifetime = { scope: string; allowed: boolean };
type Active = {
  lifetime: CallLifetime;
  id: string;
  remote: string | null;
  muted: boolean;
  started: boolean;
  phase: "starting" | "listening" | "thinking" | "speaking";
  polling: boolean;
  user: string;
  assistant: string;
  timer?: ReturnType<typeof setInterval>;
  connectionTimeout?: ReturnType<typeof setTimeout>;
  events?: { remove(): void };
  stopRemote(sessionId: string): Promise<unknown>;
};

function releaseCall(call: Active) {
  if (call.timer !== undefined) clearInterval(call.timer);
  if (call.connectionTimeout !== undefined) clearTimeout(call.connectionTimeout);
  call.events?.remove();
  void botGptVoiceNative?.closeBotVoice(call.id).catch(() => undefined);
  if (call.remote) void call.stopRemote(call.remote).catch(() => undefined);
}

export function useBotGptVoice(input: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  direct: boolean;
  visible: boolean;
  available: boolean;
}): ReturnType<typeof useBotLiveVoice> {
  const gt = useGT();
  const native = botGptVoiceNative;
  const settings = useBotGptVoiceSettings();
  const foreground = useAppForeground();
  const compatibility = useEnvironmentQuery(
    native && settings.enabled && input.direct
      ? openbot.readFromHost({
          environmentId: input.environmentId,
          input: { hostId: input.hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  const capable = settingsCapabilities(compatibility.data).includes(OPENBOT_LIVE_VOICE_CAPABILITY);
  const canOperate = useAtomValue(openbot.liveVoiceCommand.permissionAtom(input.environmentId));
  const command = useAtomCommand(openbot.liveVoiceCommand, { reportFailure: false });
  const active = useRef<Active | null>(null);
  const scope = JSON.stringify([input.environmentId, input.hostId, input.agentId]);
  const allowed = input.visible && foreground && settings.enabled && canOperate;
  const lifetime = useMemo<CallLifetime>(() => ({ scope, allowed }), [scope, allowed]);
  const [display, setDisplay] = useState<{ lifetime: CallLifetime; state: State } | null>(null);
  const state = display?.lifetime === lifetime ? display.state : null;
  const available = Boolean(native && allowed && capable && input.direct && input.available);

  function setState(state: State | null) {
    setDisplay(state ? { lifetime, state } : null);
  }

  function close(message?: string) {
    const run = active.current;
    active.current = null;
    if (run) releaseCall(run);
    setState(message ? { phase: "error", caption: message } : null);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Release this call’s native peer, timers and server connection when its owning screen or grant changes.
  useEffect(() => {
    return () => {
      const run = active.current;
      if (run?.lifetime === lifetime) {
        active.current = null;
        releaseCall(run);
      }
    };
  }, [lifetime]);

  async function start() {
    if (!native || !available || active.current) return;
    const { environmentId, hostId, agentId } = input;
    const run: Active = {
      lifetime,
      id: randomUUID(),
      remote: null,
      muted: false,
      started: false,
      phase: "starting",
      polling: false,
      user: "",
      assistant: "",
      stopRemote: (sessionId) =>
        command({ environmentId, input: { action: "stop", hostId, sessionId } }),
    };
    active.current = run;
    Keyboard.dismiss();
    setState({ phase: "starting", caption: "" });
    await (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (active.current !== run) return;
      if (!permission.granted) {
        close("Allow microphone access to start GPT live voice.");
        return;
      }
      run.events = native.addListener("onBotVoiceState", ({ id, state: peerState }) => {
        if (active.current !== run || run.id !== id) return;
        if (peerState === "failed") {
          close("The voice connection closed.");
          return;
        }
        if (peerState === "reconnecting") {
          run.phase = "starting";
          if (run.connectionTimeout !== undefined) clearTimeout(run.connectionTimeout);
          run.connectionTimeout = setTimeout(() => {
            if (active.current === run) close("The voice connection could not reconnect.");
          }, 15_000);
          setState({ phase: "starting", caption: gt("Reconnecting…") });
          return;
        }
        if (peerState === "connected") {
          if (run.connectionTimeout !== undefined) clearTimeout(run.connectionTimeout);
          run.started = true;
        }
        run.phase = peerState === "connected" ? "listening" : peerState;
        setState({
          phase: run.muted ? "muted" : run.phase,
          caption: run.phase === "speaking" ? run.assistant : run.user,
        });
      });
      run.connectionTimeout = setTimeout(() => {
        if (active.current === run) close("The voice connection timed out.");
      }, 20_000);
      const sdp = await native.createBotVoiceOffer(run.id);
      if (active.current !== run) return;
      const result = await command({
        environmentId,
        input: {
          action: "start",
          hostId,
          offer: { agentId, sdp, ...(settings.voice ? { voice: settings.voice } : {}) },
        },
      });
      if (result._tag !== "Success" || result.value._tag !== "started") {
        if (active.current === run) close("The bot computer could not start GPT live voice.");
        return;
      }
      const answer = result.value.answer;
      if (active.current !== run) {
        await run.stopRemote(answer.sessionId);
        return;
      }
      run.remote = answer.sessionId;
      await native.acceptBotVoiceAnswer(run.id, answer.sdp);
      if (active.current !== run) return;
      const poll = async () => {
        if (active.current !== run || run.polling) return;
        run.polling = true;
        await (async () => {
          const status = await command({
            environmentId,
            input: { action: "read", hostId, sessionId: answer.sessionId },
          });
          if (active.current !== run) return;
          if (status._tag !== "Success" || status.value._tag !== "state" || status.value.ended) {
            close("The bot computer ended the voice call.");
            return;
          }
          const { user, assistant } = status.value;
          if (run.started && (user !== run.user || assistant !== run.assistant)) {
            setState({
              phase: run.muted ? "muted" : run.phase,
              caption: run.phase === "speaking" ? assistant : user,
            });
          }
          run.user = user;
          run.assistant = assistant;
        })()
          .catch(() => {
            if (active.current === run) close("The voice connection was lost.");
          })
          .finally(() => {
            run.polling = false;
          });
      };
      run.timer = setInterval(() => void poll(), 700);
      void poll();
    })().catch(() => {
      if (active.current === run) close("Could not open the voice connection.");
    });
  }

  return {
    available,
    state,
    start,
    end: () => close(),
    retry: () => {},
    mute: () => {
      const run = active.current;
      if (!native || !run) return;
      run.muted = !run.muted;
      void native
        .setBotVoiceMuted(run.id, run.muted)
        .then(() => {
          if (active.current === run)
            setState({ phase: run.muted ? "muted" : run.phase, caption: run.user });
        })
        .catch(() => {
          if (active.current === run) close("Could not change the microphone.");
        });
    },
    interrupt: async () => {
      const run = active.current;
      if (!run || !native) return;
      try {
        await native.interruptBotVoice(run.id);
        if (active.current === run) {
          run.phase = "listening";
          setState({ phase: "listening", caption: run.user });
        }
      } catch {
        if (active.current === run) close("Could not silence the current reply.");
      }
    },
  };
}
