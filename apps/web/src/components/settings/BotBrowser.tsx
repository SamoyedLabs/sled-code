import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  browserActionLabel,
  browserTabActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { requestConfirmDialog } from "../../confirmDialog";
import { useBotBrowser } from "./useBotBrowser";
import { useBotBrowserViewer } from "./useBotBrowserViewer";
import { BotBrowserView } from "./BotBrowserView";
import { openbot } from "../../state/openbot";

type Props = { environmentId: EnvironmentId; hostId: string; agentId?: string };
export function BotBrowser(props: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section aria-label="Bot browser" className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Close browser" : "Browser"}
      </Button>
      <div id={id}>
        {expanded && (
          <BrowserPanel
            key={`${props.environmentId}:${props.hostId}:${props.agentId ?? "host"}`}
            {...props}
          />
        )}
      </div>
    </section>
  );
}
function Viewer({
  environmentId,
  hostId,
  tabId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  tabId: string;
}) {
  const connect = useBotBrowserViewer(environmentId, hostId, tabId);
  return <BotBrowserView connect={connect} />;
}
function BrowserPanel({
  environmentId,
  hostId,
  agentId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
}) {
  const browser = useBotBrowser(environmentId, hostId);
  const canView = useAtomValue(openbot.browserViewCommand.permissionAtom(environmentId));
  const [viewTab, setViewTab] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [profileName, setProfileName] = useState("");
  return (
    <section aria-label="Bot browser" aria-busy={browser.busy} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={browser.refresh}>
          Refresh browser
        </Button>
        <Button
          variant="outline"
          disabled={browser.busy || !browser.canControl}
          onClick={() => void browser.act({ operation: "browser.profiles.list" })}
        >
          Load profiles
        </Button>
      </div>
      {browser.error && <p role="alert">{browser.error}</p>}
      <p className="text-sm text-muted-foreground">
        Taking control pauses bot interaction with that tab until you return control.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void browser.act({ operation: "browser.open", url, focus: true });
        }}
      >
        <Input
          aria-label="Browser address"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          maxLength={2048}
          placeholder="https://example.com"
        />
        <Button disabled={browser.busy || !browser.canControl || !url.trim()}>Open tab</Button>
      </form>
      {!browser.display && (
        <p role="status">Browser state unavailable. Start the bot host and refresh.</p>
      )}
      <ul className="space-y-3">
        {browser.display?.tabs.map((tab) => (
          <li key={tab.id} className="rounded border p-3 space-y-2">
            <p className="break-words font-medium">
              {tab.title || "Untitled tab"}
              {browser.display?.activeTabId === tab.id ? " · Active" : ""}
            </p>
            <p className="break-all text-sm">{tab.url}</p>
            <p className="text-sm">
              {tab.userControl ? "Human control" : "Bot control"}
              {tab.ownerAgentId ? ` · Bot ${tab.ownerAgentId}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canView}
                onClick={() => setViewTab(viewTab === tab.id ? null : tab.id)}
              >
                {viewTab === tab.id ? "Close view" : "View page"}
              </Button>
              {browserTabActions(tab).map((request) => (
                <Button
                  key={JSON.stringify(request)}
                  size="sm"
                  variant="outline"
                  disabled={browser.busy || !browser.canControl}
                  onClick={() => void browser.act(request)}
                >
                  {browserActionLabel(request)}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={browser.busy || !browser.canControl || !url.trim()}
                onClick={() => void browser.act({ operation: "browser.load", tabId: tab.id, url })}
              >
                Load address here
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {viewTab && canView && browser.display?.tabs.some((tab) => tab.id === viewTab) && (
        <Viewer
          key={`${hostId}:${viewTab}`}
          environmentId={environmentId}
          hostId={hostId}
          tabId={viewTab}
        />
      )}
      {browser.profiles && (
        <div className="space-y-2">
          <p>Named profiles keep their sign-ins on the host.</p>
          {agentId && (
            <div className="flex gap-2">
              {(["shared", "agent"] as const).map((kind) => (
                <Button
                  key={kind}
                  variant="outline"
                  disabled={browser.busy || !browser.canControl}
                  onClick={async () => {
                    if (
                      await requestConfirmDialog("Change the bot profile? Its existing tabs close.")
                    )
                      void browser.act({
                        operation: "browser.profile.assign",
                        agentId,
                        profile: { kind },
                      });
                  }}
                >
                  {kind === "shared" ? "Use shared profile" : "Use bot-only profile"}
                </Button>
              ))}
            </div>
          )}
          <ul>
            {browser.profiles.map((profile) => (
              <li key={profile.id}>
                {profile.name} · {profile.tabCount} tabs
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={browser.busy || !browser.canControl || !profileName.trim()}
                    onClick={() =>
                      void browser.act({
                        operation: "browser.profiles.update",
                        profileId: profile.id,
                        name: profileName,
                      })
                    }
                  >
                    Rename to entered name
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={browser.busy || !browser.canControl}
                    onClick={async () => {
                      if (
                        await requestConfirmDialog(
                          "Clear this profile? Its tabs close and all sites are signed out.",
                          { variant: "destructive" },
                        )
                      )
                        void browser.act({
                          operation: "browser.profiles.clear",
                          profileId: profile.id,
                        });
                    }}
                  >
                    Clear sign-ins
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={browser.busy || !browser.canControl}
                    onClick={async () => {
                      if (
                        await requestConfirmDialog(
                          "Delete this profile? Its tabs close and its bots move to the shared profile.",
                          { variant: "destructive" },
                        )
                      )
                        void browser.act({
                          operation: "browser.profiles.delete",
                          profileId: profile.id,
                        });
                    }}
                  >
                    Delete profile
                  </Button>
                  {agentId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={browser.busy || !browser.canControl}
                      onClick={async () => {
                        if (
                          await requestConfirmDialog(
                            "Use this profile for the bot? Its existing tabs close.",
                          )
                        )
                          void browser.act({
                            operation: "browser.profile.assign",
                            agentId,
                            profile: { kind: "profile", profileId: profile.id },
                          });
                      }}
                    >
                      {profile.agentIds.includes(agentId) ? "Assigned to bot" : "Assign to bot"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void browser.act({ operation: "browser.profiles.create", name: profileName });
            }}
          >
            <Input
              aria-label="Profile name for create or rename"
              value={profileName}
              maxLength={60}
              onChange={(event) => setProfileName(event.target.value)}
            />
            <Button disabled={browser.busy || !browser.canControl || !profileName.trim()}>
              Create profile
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
