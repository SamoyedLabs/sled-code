import { useEffect, useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  browserActionLabel,
  browserTabActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { useStableCallback } from "../../hooks/useStableCallback";
import { GlobeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { requestConfirmDialog } from "../../confirmDialog";
import { useBotBrowser } from "./useBotBrowser";
import { useBotBrowserViewer } from "./useBotBrowserViewer";
import { BotBrowserView } from "./BotBrowserView";
import { openbot } from "../../state/openbot";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
  initiallyExpanded?: boolean;
  workspace?: boolean;
};
export function BotBrowser(props: Props) {
  const [expanded, setExpanded] = useState(props.initiallyExpanded ?? false);
  const id = useId();
  return (
    <section aria-label="Bot browser" className="space-y-3">
      {!props.workspace && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close browser" : "Browser"}
        </Button>
      )}
      <div id={id}>
        {(expanded || props.workspace) && (
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
  interactive,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  tabId: string;
  interactive: boolean;
}) {
  const connect = useBotBrowserViewer(environmentId, hostId, tabId);
  return <BotBrowserView connect={connect} interactive={interactive} />;
}
function BrowserPanel({
  environmentId,
  hostId,
  agentId,
  workspace = false,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
  workspace?: boolean;
}) {
  const browser = useBotBrowser(environmentId, hostId);
  const canView = useAtomValue(openbot.browserViewCommand.permissionAtom(environmentId));
  const [viewTab, setViewTab] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [profileName, setProfileName] = useState("");
  const refresh = useStableCallback(browser.refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the selected host browser when its workspace opens or permission becomes available.
  useEffect(() => {
    if (workspace && browser.canControl) refresh();
  }, [workspace, browser.canControl, refresh]);
  return (
    <section aria-label="Browser workspace" aria-busy={browser.busy} className="space-y-4">
      {workspace && (
        <div>
          <h2 className="text-lg font-semibold">Browser</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a page or join a bot’s browser tab.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={browser.refresh}>
          <RefreshCwIcon className="size-4" /> Refresh browser
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
        <Button type="submit" disabled={browser.busy || !browser.canControl || !url.trim()}>
          <PlusIcon className="size-4" />
          Open tab
        </Button>
      </form>
      {!browser.display && (
        <p role="status">Browser state unavailable. Start the bot host and refresh.</p>
      )}
      {workspace && (
        <nav aria-label="Browser tabs" className="flex gap-1 overflow-x-auto border-b pb-2">
          {browser.display?.tabs.map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={viewTab === tab.id ? "secondary" : "ghost"}
              aria-pressed={viewTab === tab.id}
              disabled={!canView}
              onClick={() => setViewTab(tab.id)}
            >
              <GlobeIcon className="size-4" />
              <span className="max-w-44 truncate">{tab.title || "Untitled tab"}</span>
            </Button>
          ))}
        </nav>
      )}
      {workspace && browser.display?.tabs.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No open tabs. Enter an address above to begin.
        </p>
      )}
      <ul className="space-y-3">
        {browser.display?.tabs.map((tab) => (
          <li
            key={tab.id}
            hidden={workspace && viewTab !== tab.id}
            className="rounded-xl border p-4 space-y-2"
          >
            <p className="break-words font-medium">
              {tab.title || "Untitled tab"}
              {browser.display?.activeTabId === tab.id ? " · Active" : ""}
            </p>
            <p className="break-all text-sm">{tab.url}</p>
            <p className="text-sm">
              {tab.userControl ? "Human control" : "Bot control"}
              {tab.ownerAgentId === agentId ? " · This bot" : ""}
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
          interactive={
            browser.display?.tabs.find((tab) => tab.id === viewTab)?.userControl === true
          }
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
