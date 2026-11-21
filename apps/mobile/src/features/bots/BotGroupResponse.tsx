import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotChannelMessage,
  OpenbotChannelSummary,
} from "@t3tools/contracts";
import {
  channelConversationMessage,
  channelPromptSnapshot,
} from "@t3tools/client-runtime/openbot/presentation";
import { blockAnswers } from "@t3tools/client-runtime/openbot/rich-conversation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotResponseBlock } from "../settings/BotResponseBlock";
import { useBotPalette } from "./upstream/BotChrome";

export function BotGroupResponse({
  environmentId,
  hostId,
  channel,
  entry,
  disabled,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  channel: OpenbotChannelSummary;
  entry: OpenbotChannelMessage;
  disabled: boolean;
}) {
  const p = useBotPalette();
  const attention = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const respond = useAtomCommand(openbot.attentionRespond, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const snapshot =
    attention.isPending || attention.error
      ? null
      : channelPromptSnapshot(hostId, channel, entry, attention.data);
  const message = channelConversationMessage(entry);
  if (!message) return null;
  return (
    <>
      <BotResponseBlock
        environmentId={environmentId}
        hostId={hostId}
        message={message}
        snapshot={snapshot}
        taskId={null}
        disabled={disabled || !canRespond || !snapshot}
        respond={async (command) => {
          if (disabled || !snapshot || !canRespond) return false;
          const answers = blockAnswers(snapshot, command);
          if (!answers) return false;
          setError(null);
          const result = await respond({
            environmentId,
            input: {
              hostId,
              request: { operation: "prompt.respond", requestId: command.requestId, answers },
            },
          });
          if (result._tag === "Failure") {
            setError(String(squashAtomCommandFailure(result)));
            return false;
          }
          attention.refresh();
          return true;
        }}
      />
      {error && (
        <Text accessibilityRole="alert" style={{ color: p.text, fontSize: 13 }}>
          {error}
        </Text>
      )}
    </>
  );
}
