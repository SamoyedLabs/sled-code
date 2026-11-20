import { useAtomValue } from "@effect/atom-react";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import {
  OpenbotContextState,
  type EnvironmentId,
  type OpenbotAdminRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";

type Scope = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  threadId: string | null;
};
const decode = Schema.decodeUnknownOption(OpenbotContextState);
const categoryLabels = {
  systemPrompt: "System prompt",
  memoryFiles: "Memory files",
  tools: "Tools",
  skills: "Skills",
  toolResults: "Tool results",
  messages: "Messages",
  other: "Other",
};
const tokens = new Intl.NumberFormat();

export function useBotChatContext({ environmentId, hostId, agentId, threadId }: Scope) {
  const query = useEnvironmentQuery(
    threadId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "context.read", agentId, threadId } },
        })
      : null,
  );
  const compatibility = useEnvironmentQuery(
    threadId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  const state = decode(query.data);
  const context =
    query.isSuccess &&
    state._tag === "Some" &&
    state.value.botId === agentId &&
    state.value.threadId === threadId
      ? state.value
      : null;
  return { context, capabilities: settingsCapabilities(compatibility.data) };
}

export function BotChatContextSheet({
  environmentId,
  hostId,
  agentId,
  taskId,
  state,
  capabilities,
  turnActive,
  onClose,
  onChanged,
}: Omit<Scope, "threadId"> & {
  taskId: string | null;
  state: OpenbotContextState | null;
  capabilities: readonly string[];
  turnActive: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const palette = useBotPalette();
  const permissionsRequest: OpenbotAdminRequest = taskId
    ? { operation: "settings.context-compact.compactTask", parameters: { agentId, taskId } }
    : { operation: "settings.context-reset.clear", parameters: { agentId } };
  const canUpdate = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: permissionsRequest,
    }),
  );
  const submit = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const usage = state?.usage;
  const compaction = state?.compaction;
  const ratio = usage ? Math.max(0, Math.min(1, usage.usedTokens / usage.windowTokens)) : 0;
  const filled = Math.round(ratio * 100);
  const disabled = !canUpdate || pending || turnActive || compaction?.status === "running";
  const act = async (request: OpenbotAdminRequest, clear: boolean) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setPending(true);
    setStatus(null);
    try {
      const result = await submit({ environmentId, input: { hostId, request } });
      if (result._tag === "Success") {
        onChanged();
        if (clear) onClose();
        else setStatus("Compaction requested.");
      } else setStatus("The host could not update this context.");
    } catch {
      setStatus("The host could not update this context.");
    }
    lock.current = false;
    setPending(false);
  };
  return (
    <Sheet title="Context" onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        {usage && (
          <>
            <Text style={{ color: palette.muted }}>
              {usage.estimated ? "About " : ""}
              {tokens.format(usage.usedTokens)} of {tokens.format(usage.windowTokens)} tokens
            </Text>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Context usage"
              accessibilityValue={{ min: 0, max: 100, now: filled }}
              style={{
                height: 7,
                borderRadius: 4,
                overflow: "hidden",
                backgroundColor: palette.control,
              }}
            >
              <View
                style={{
                  height: 7,
                  width: `${filled}%`,
                  borderRadius: 4,
                  backgroundColor: palette.action,
                }}
              />
            </View>
            {usage.categories?.map(({ category, tokens: count }) => (
              <View key={category} className="flex-row justify-between gap-2">
                <Text style={{ color: palette.text }}>{categoryLabels[category]}</Text>
                <Text style={{ color: palette.muted }}>{tokens.format(count)}</Text>
              </View>
            ))}
          </>
        )}
        {compaction && (
          <Text accessibilityLiveRegion="polite">
            {compaction.status === "running"
              ? "Compacting context…"
              : compaction.status === "completed"
                ? "Context compacted."
                : "Compaction failed."}
          </Text>
        )}
        {status && <Text accessibilityLiveRegion="polite">{status}</Text>}
        {usage && capabilities.includes("context-compact-v1") && (
          <Button
            label="Compact now"
            disabled={disabled}
            onPress={() =>
              void act(
                taskId
                  ? {
                      operation: "settings.context-compact.compactTask",
                      parameters: { agentId, taskId },
                    }
                  : { operation: "settings.context-compact.compact", parameters: { agentId } },
                false,
              )
            }
          />
        )}
        {!taskId && capabilities.includes("context-reset-v1") && (
          <Button
            label="Start a new chat"
            disabled={disabled}
            onPress={() =>
              Dialog.alert(
                "Start a new chat?",
                "The agent starts with a fresh context. Existing messages stay in your history.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Start new chat",
                    onPress: () =>
                      void act(
                        { operation: "settings.context-reset.clear", parameters: { agentId } },
                        true,
                      ),
                  },
                ],
              )
            }
          />
        )}
      </ScreenScrollView>
    </Sheet>
  );
}
