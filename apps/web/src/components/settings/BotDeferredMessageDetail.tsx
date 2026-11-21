import { useState } from "react";
import {
  OpenbotConversationDetail,
  type OpenbotConversationDetailField,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { T, useGT } from "gt-react";

const decode = Schema.decodeUnknownResult(OpenbotConversationDetail);

export function BotDeferredMessageDetail({
  environmentId,
  hostId,
  agentId,
  taskId,
  messageId,
  field,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  taskId: string | null;
  messageId: string;
  field: OpenbotConversationDetailField;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<{ offset: number; version: string | null }>({
    offset: 0,
    version: null,
  });
  const [previous, setPrevious] = useState<readonly number[]>([]);
  const query = useEnvironmentQuery(
    expanded
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "conversation.detail",
              agentId,
              taskId,
              messageId,
              field,
              ...cursor,
            },
          },
        })
      : null,
  );
  const decoded = decode(query.data);
  const page =
    Result.isSuccess(decoded) &&
    decoded.success.messageId === messageId &&
    decoded.success.field === field &&
    decoded.success.offset === cursor.offset
      ? decoded.success
      : null;
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{field === "text" ? gt("Read full message") : field}</summary>
      {query.error && (
        <div role="alert">
          <p>
            <T>This content changed or could not be loaded. Reload it from the selected host.</T>
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPrevious([]);
              setCursor({ offset: 0, version: null });
              query.refresh();
            }}
          >
            <T>Reload content</T>
          </Button>
        </div>
      )}
      {query.isPending && (
        <p role="status">
          <T>Loading content…</T>
        </p>
      )}
      {page && (
        <>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
            {page.value}
          </pre>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!previous.length || query.isPending}
              onClick={() => {
                const offset = previous.at(-1);
                if (offset === undefined) return;
                setPrevious(previous.slice(0, -1));
                setCursor({ offset, version: page.version });
              }}
            >
              <T>Previous part</T>
            </Button>
            <span>
              {page.offset + 1}–{page.offset + page.value.length} of {page.totalLength} characters
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page.nextOffset === null || query.isPending}
              onClick={() => {
                if (page.nextOffset === null) return;
                setPrevious([...previous, page.offset]);
                setCursor({ offset: page.nextOffset, version: page.version });
              }}
            >
              <T>Next part</T>
            </Button>
          </div>
        </>
      )}
    </details>
  );
}
