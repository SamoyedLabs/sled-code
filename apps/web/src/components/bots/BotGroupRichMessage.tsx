import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OpenbotChannelMessage,
  OpenbotChannelSummary,
} from "@t3tools/contracts";
import {
  channelPromptSnapshot,
  channelConversationMessage,
  channelAttentionRequests,
} from "@t3tools/client-runtime/openbot/presentation";
import { blockAnswers } from "@t3tools/client-runtime/openbot/rich-conversation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotResponseBlock } from "../settings/BotResponseBlock";
import { BotAttentionRequest } from "../settings/BotAttention";

export function BotGroupRequests({
  environmentId,
  hostId,
  channel,
  entries,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  channel: OpenbotChannelSummary;
  entries: readonly OpenbotChannelMessage[];
}) {
  const attention = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const requests = channelAttentionRequests(hostId, channel, attention.data).filter(
    (request) =>
      !entries.some(
        (entry) =>
          entry.message.uiBlock != null &&
          attention.data &&
          channelPromptSnapshot(hostId, channel, entry, {
            ...attention.data,
            requests: [request],
          }) !== null,
      ),
  );
  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <BotAttentionRequest
          key={`${request.kind}:${request.requestId}`}
          environmentId={environmentId}
          hostId={hostId}
          request={request}
          agentName={
            entries.find((entry) => entry.author.id === request.agentId)?.author.name ?? "Bot"
          }
          disabled={!canRespond || attention.isPending || Boolean(attention.error)}
        />
      ))}
    </div>
  );
}

export function BotGroupRichMessage({
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
  const attention = useEnvironmentQuery(openbot.attention({ environmentId, input: {} }));
  const canRespond = useAtomValue(openbot.attentionRespond.permissionAtom(environmentId));
  const respond = useAtomCommand(openbot.attentionRespond, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const snapshot =
    attention.error || attention.isPending
      ? null
      : channelPromptSnapshot(hostId, channel, entry, attention.data);
  const message = channelConversationMessage(entry);
  if (!message) return null;
  return (
    <div className="space-y-2">
      <BotResponseBlock
        environmentId={environmentId}
        hostId={hostId}
        message={message}
        snapshot={snapshot}
        taskId={null}
        disabled={disabled || !canRespond || !snapshot}
        respond={async (command) => {
          if (!snapshot || disabled || !canRespond) return false;
          const answers = blockAnswers(snapshot, command);
          if (!answers) return false;
          setError(null);
          const result = await respond({
            environmentId,
            input: {
              hostId,
              request: {
                operation: "prompt.respond",
                requestId: command.requestId,
                answers,
              },
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
