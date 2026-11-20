import { useRef } from "react";
import * as Schema from "effect/Schema";
import {
  OpenbotConversationSearchPage,
  OpenbotConversationFilePage,
  type EnvironmentId,
  type OpenbotAgent,
  type OpenbotChannelSummary,
} from "@t3tools/contracts";
import { useBotRoutineIndex } from "./useBotRoutineIndex";
import { openbot } from "../../state/openbot";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { readPreparedConnection } from "../../state/session";
import { GlobalSearch, type SearchTarget, type SearchAction } from "./upstream/search/GlobalSearch";
const decodeMessages = Schema.decodeUnknownSync(OpenbotConversationSearchPage);
const decodeFiles = Schema.decodeUnknownSync(OpenbotConversationFilePage);
export function SourceGlobalSearch(props: {
  environmentId: EnvironmentId;
  hostId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: readonly (typeof OpenbotAgent.Type)[];
  channels: readonly OpenbotChannelSummary[];
  onSelect: (target: SearchTarget) => void;
  actions: readonly SearchAction[];
}) {
  const read = useAtomQueryRunner(openbot.readFromHost, { reportFailure: false, refresh: true }),
    files = useAtomQueryRunner(openbot.fileSearch, { reportFailure: false, refresh: true });
  const routines = useBotRoutineIndex({
    enabled: props.open,
    environmentId: props.environmentId,
    hostId: props.hostId,
    agents: props.agents,
    channels: props.channels,
  });
  const scopeConnection = useRef(readPreparedConnection(props.environmentId));
  const searchMessages = async (query: string, cursor?: string) => {
    if (readPreparedConnection(props.environmentId) !== scopeConnection.current)
      throw Error("Search connection changed.");
    const result = await read({
      environmentId: props.environmentId,
      input: {
        hostId: props.hostId,
        request: {
          operation: "conversation.search",
          query,
          limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
        },
      },
    });
    if (
      result._tag === "Failure" ||
      readPreparedConnection(props.environmentId) !== scopeConnection.current
    )
      throw Error("Message search could not be completed.");
    const page = decodeMessages(result.value);
    return page;
  };
  const searchFiles = async (query: string, cursor?: string) => {
    if (readPreparedConnection(props.environmentId) !== scopeConnection.current)
      throw Error("Search connection changed.");
    const result = await files({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, query, ...(cursor !== undefined ? { cursor } : {}) },
    });
    if (
      result._tag === "Failure" ||
      readPreparedConnection(props.environmentId) !== scopeConnection.current
    )
      throw Error("File search could not be completed.");
    const page = decodeFiles(result.value);
    return {
      results: page.results.map((file) => ({
        id: file.attachment.id,
        name: file.attachment.name,
        agentId: file.agentId,
        messageId: file.messageId,
        ...(file.taskId ? { taskId: file.taskId } : {}),
        time: new Date(file.createdAt).toLocaleString(),
      })),
      nextCursor: page.nextCursor,
    };
  };
  return (
    <GlobalSearch
      open={props.open}
      onOpenChange={props.onOpenChange}
      agents={props.agents}
      channels={props.channels}
      routines={routines.items}
      routinesLoading={routines.pending}
      routinesFailed={routines.failed}
      onRetryRoutines={routines.refresh}
      actions={props.actions}
      onSearchMessages={searchMessages}
      onSearchFiles={searchFiles}
      onSelect={props.onSelect}
    />
  );
}
