import type { EnvironmentId } from "@t3tools/contracts";
import { MessagingOrchestrators } from "./BotMessagingOrchestrators";
import { useState } from "react";
import {
  botMessagingGrant,
  type BotMessagingPlatform,
} from "@t3tools/client-runtime/openbot/presentation";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirmed, ExternalLink } from "./BotConnectionControls";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function MessagingPanel({
  controller,
  allowed,
  environmentId,
  hostId,
}: PanelProps & { environmentId: EnvironmentId; hostId: string }) {
  const { state, run, busy, setError } = controller;
  const [platform, setPlatform] = useState<BotMessagingPlatform>("slack");
  const [callback, setCallback] = useState("");
  const page = state.page?.platform === platform ? state.page : null;
  const rows = state.messaging[platform]?.connections;
  const complete = async () => {
    if (!page?.nonce || platform === "telegram") return;
    const request = botMessagingGrant(platform, callback, page.nonce);
    setCallback("");
    if (!request) {
      setError("The return link must match this platform and pending connection.");
      return;
    }
    await run([request, { operation: "connector.messaging.overview", platform }]);
  };
  const remove = async (workspaceId: string) => {
    if (
      await confirmed(
        "Disconnect this workspace or chat from the host? If no other linked place uses its orchestrator, Openbot also deletes that bot. Active work may need to finish first.",
      )
    )
      await run([
        { operation: "connector.messaging.disconnect", platform, workspaceId },
        { operation: "connector.messaging.overview", platform },
      ]);
  };
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>Messaging platform</span>
        <Select
          value={platform}
          disabled={busy}
          onValueChange={(value) => {
            if (value === "slack" || value === "discord" || value === "telegram") {
              setPlatform(value);
              setCallback("");
            }
          }}
        >
          <SelectTrigger aria-label="Messaging platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="slack">Slack</SelectItem>
            <SelectItem value="discord">Discord</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          onClick={() => void run([{ operation: "connector.messaging.overview", platform }])}
        >
          Load connections
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          onClick={() =>
            void run([{ operation: "connector.messaging.connect", platform, place: "group" }])
          }
        >
          {platform === "telegram" ? "Connect group chat" : "Connect workspace"}
        </Button>
        {platform === "telegram" && (
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || busy}
            onClick={() =>
              void run([{ operation: "connector.messaging.connect", platform, place: "direct" }])
            }
          >
            Connect direct chat
          </Button>
        )}
      </div>
      {page && (
        <div className="space-y-2">
          <ExternalLink disabled={!allowed || busy} address={page.url}>
            Open connection page
          </ExternalLink>
          {page.nonce && platform !== "telegram" && (
            <>
              <label className="block space-y-1 text-sm">
                <span>Return link from the connection page</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={callback}
                  disabled={busy || !allowed}
                  onChange={(event) => setCallback(event.target.value)}
                />
              </label>
              <Button
                size="sm"
                disabled={!allowed || busy || !callback.trim()}
                onClick={() => void complete()}
              >
                Complete connection
              </Button>
              <p className="text-xs text-muted-foreground">
                Paste the openbot return link if the browser cannot hand it back to Sled. Its sealed
                grant clears after submission.
              </p>
            </>
          )}
        </div>
      )}
      {rows && (
        <MessagingOrchestrators
          controller={controller}
          allowed={allowed}
          environmentId={environmentId}
          hostId={hostId}
          platform={platform}
        />
      )}
      {rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">No connections for this platform.</p>
      )}
      {rows?.map((row) => (
        <div key={row.workspaceId} className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">
            {row.workspaceName} · {row.state}
          </p>
          {row.missingScopes.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Missing permissions: {row.missingScopes.join(", ")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() =>
                void run([
                  {
                    operation: "connector.messaging.enabled",
                    platform,
                    workspaceId: row.workspaceId,
                    enabled: !row.enabled,
                  },
                  { operation: "connector.messaging.overview", platform },
                ])
              }
            >
              {row.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() =>
                void run([
                  {
                    operation: "connector.messaging.reconnect",
                    platform,
                    workspaceId: row.workspaceId,
                  },
                ])
              }
            >
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!allowed || busy}
              onClick={() => void remove(row.workspaceId)}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
