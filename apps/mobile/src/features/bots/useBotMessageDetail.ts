import {
  OpenbotConversationDetail,
  type EnvironmentId,
  type OpenbotConversationDetailField,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { useLayoutEffect, useRef, useState } from "react";
import { appAtomRegistry } from "../../state/atom-registry";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

export type BotMessageDetailScope = {
  environmentId: EnvironmentId;
  hostId: string;
  messageId: string;
} & (
  | { channelId: string; agentId?: never; taskId?: never }
  | { channelId?: never; agentId: string; taskId: string | null }
);

const decodePage = Schema.decodeUnknownResult(OpenbotConversationDetail);
const MAX_DETAIL_LENGTH = 2 * 1024 * 1024;

export function useBotMessageDetail(scope: BotMessageDetailScope) {
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true });
  const connectionAtom = environmentSession.preparedConnectionValueAtom(scope.environmentId);
  const currentConnection = () => Option.getOrNull(appAtomRegistry.get(connectionAtom));
  const attempt = useRef<symbol | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [data, setData] = useState<unknown>();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Discard late reads when their message leaves the screen.
  useLayoutEffect(
    () => () => {
      attempt.current = null;
    },
    [],
  );

  async function load(field: OpenbotConversationDetailField) {
    if (attempt.current || phase === "ready") return;
    if (scope.channelId !== undefined && field !== "trace") return;
    const connection = currentConnection();
    if (!connection) {
      setPhase("error");
      return;
    }
    const token = Symbol();
    attempt.current = token;
    setPhase("loading");
    const requireCurrent = () => {
      if (attempt.current !== token || currentConnection() !== connection) {
        throw new Error("Message detail connection changed");
      }
    };
    await (async () => {
      let offset = 0;
      let version: string | null = null;
      let text = "";
      let totalLength: number | null = null;
      for (let part = 0; part < 128; part++) {
        requireCurrent();
        const result = await read({
          environmentId: scope.environmentId,
          input: {
            hostId: scope.hostId,
            request:
              scope.channelId !== undefined
                ? {
                    operation: "channel.trace",
                    channelId: scope.channelId,
                    messageId: scope.messageId,
                    offset,
                    version,
                  }
                : {
                    operation: "conversation.detail",
                    agentId: scope.agentId,
                    taskId: scope.taskId,
                    messageId: scope.messageId,
                    field,
                    offset,
                    version,
                  },
          },
        });
        requireCurrent();
        if (result._tag === "Failure") throw new Error("Message detail read failed");
        const parsed = decodePage(result.value);
        if (!Result.isSuccess(parsed)) throw new Error("Unsupported message detail");
        const page = parsed.success;
        if (
          page.messageId !== scope.messageId ||
          page.field !== field ||
          page.offset !== offset ||
          (version !== null && page.version !== version) ||
          (totalLength !== null && totalLength !== page.totalLength) ||
          page.totalLength > MAX_DETAIL_LENGTH
        )
          throw new Error("Message detail changed");
        totalLength = page.totalLength;
        text += page.value;
        if (text.length > MAX_DETAIL_LENGTH)
          throw new Error("Message detail exceeds the size limit");
        if (page.nextOffset === null) {
          if (text.length !== page.totalLength) throw new Error("Incomplete message detail");
          setData(JSON.parse(text));
          setPhase("ready");
          return;
        }
        if (page.nextOffset !== offset + page.value.length || page.nextOffset <= offset)
          throw new Error("Invalid message detail page");
        offset = page.nextOffset;
        version = page.version;
      }
      throw new Error("Message detail exceeds the page limit");
    })()
      .catch(() => {
        if (attempt.current === token) setPhase("error");
      })
      .finally(() => {
        if (attempt.current === token) attempt.current = null;
      });
  }

  const clear = () => {
    attempt.current = null;
    setData(undefined);
    setPhase("idle");
  };
  return { data, phase, load, clear };
}
