/* oxlint-disable shadcn/no-unknown-classes -- Source browser workspace stylesheet. */
import { useContext, useEffect, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useBotBrowser } from "../settings/useBotBrowser";
import { useBotBrowserViewer } from "../settings/useBotBrowserViewer";
import { BotBrowserView } from "../settings/BotBrowserView";
import { useBotComputer } from "../settings/useBotComputer";
import { useComputerViewActions } from "../settings/ComputerViewActions";
import { usePreparedConnection, readPreparedConnection } from "../../state/session";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useStableCallback } from "../../hooks/useStableCallback";
import { BrowserFullView } from "./upstream/browser/BrowserFullView";
import { ComputerWorkspace } from "./upstream/browser/ComputerWorkspace";
import { BROWSER_NEW_TAB_URL } from "./upstream/browser/browser-suggestions";
import {
  emptyBrowserSession,
  moveTab,
  orderedTabs,
  rememberClosed,
  syncBrowserSession,
} from "./upstream/browser/session";
import "./upstream/browser/Browser.css";
export interface SourceBrowserEnvironmentProps {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  onClose?: () => void;
}
export function SourceBrowserEnvironment(props: SourceBrowserEnvironmentProps) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (connection !== session.connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <BrowserEnvironment
      key={`${props.environmentId}:${props.hostId}:${props.agentId}:${session.epoch}`}
      {...props}
    />
  );
}
function BrowserViewer({
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
  return <BotBrowserView connect={connect} interactive={interactive} source />;
}
function BrowserEnvironment({ environmentId, hostId, onClose }: SourceBrowserEnvironmentProps) {
  const browser = useBotBrowser(environmentId, hostId);
  const registry = useContext(RegistryContext);
  const canView = useAtomValue(openbot.browserViewCommand.permissionAtom(environmentId));
  const [mode, setMode] = useState<"browser" | "computer">("browser");
  const [session, setSession] = useState(emptyBrowserSession);
  const [display, setDisplay] = useState(browser.display);
  if (display !== browser.display) {
    setDisplay(browser.display);
    if (browser.display)
      setSession((current) => syncBrowserSession(current, browser.display!.tabs));
  }
  const [selected, setSelected] = useState<string | null>(null);
  const tabs = orderedTabs(session, browser.display?.tabs ?? []);
  const active =
    tabs.find((tab) => tab.id === selected) ??
    tabs.find((tab) => tab.id === browser.display?.activeTabId) ??
    tabs[0];
  const viewer = useComputerViewActions(environmentId, hostId);
  const canCheckSetup = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "computer.setup" },
    }),
  );
  const capabilities = useAtomCommand(openbot.computerCapabilities, { reportFailure: false });
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const connection = readPreparedConnection(environmentId);
  const computer = useBotComputer({
    viewer,
    canCheckSetup,
    canSelectDisplay: (displayId) =>
      registry.get(
        openbot.adminToHost.permissionAtom(environmentId, {
          hostId,
          request: { operation: "computer.display", displayId },
        }),
      ),
    capabilities: async () => {
      const result = await capabilities({
        environmentId,
        input: { hostId, request: { operation: "computer.capabilities" } },
      });
      if (result._tag === "Failure" || readPreparedConnection(environmentId) !== connection)
        throw new Error("Computer capabilities unavailable");
      return result.value;
    },
    execute: async (request) => {
      const result = await admin({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure" || readPreparedConnection(environmentId) !== connection)
        throw new Error("Computer request unavailable");
      return result.value;
    },
  });
  const refresh = useStableCallback(browser.refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reconcile host-created tabs while this browser surface is visible; every read stays on the existing guarded controller.
  useEffect(() => {
    if (!browser.canControl) return;
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 2000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [browser.canControl, refresh]);
  const open = async (url: string, afterId?: string, index?: number) => {
    setSession((current) => ({
      ...current,
      pending: { ...(afterId ? { afterId } : {}), ...(index !== undefined ? { index } : {}) },
    }));
    await browser.act({
      operation: "browser.open",
      url,
      focus: true,
      ownerAgentId: null,
      ownerThreadId: null,
    });
    setSelected(null);
  };
  const closeTabs = async (ids: readonly string[]) => {
    setSession((current) => rememberClosed(current, tabs, ids));
    for (const tabId of ids) await browser.act({ operation: "browser.close", tabId });
  };
  return (
    <div className="browser-source-workspace">
      {mode === "computer" ? (
        <ComputerWorkspace computer={computer} hostId={hostId} onBack={() => setMode("browser")} />
      ) : (
        <BrowserFullView
          {...(window.desktopBridge
            ? { shortcuts: navigator.platform.includes("Mac") ? ("mac" as const) : ("pc" as const) }
            : {})}
          tabs={tabs}
          activeTab={active}
          history={session.history}
          canReopen={session.closed.length > 0}
          canControl={browser.canControl && !browser.busy}
          canCloseTabs={browser.canControl && !browser.busy}
          onActivateTab={(id) => {
            setSelected(id);
            void browser.act({ operation: "browser.activate", tabId: id });
          }}
          onCloseTabs={(ids) => {
            void closeTabs(ids);
          }}
          onNewTab={(afterId) => open(BROWSER_NEW_TAB_URL, afterId)}
          onDuplicateTab={(id) => {
            const tab = tabs.find((tab) => tab.id === id);
            if (tab) void open(tab.url, id);
          }}
          onMoveTab={(id, index) => setSession((current) => moveTab(current, tabs, id, index))}
          onReopenTab={() => {
            const closed = session.closed[0];
            if (closed) {
              setSession((current) => ({ ...current, closed: current.closed.slice(1) }));
              void open(closed.url, undefined, closed.index);
            }
          }}
          onReload={(tabId) => {
            void browser.act({ operation: "browser.reload", tabId });
          }}
          onStop={(tabId) => {
            void browser.act({ operation: "browser.stop", tabId });
          }}
          onNavigate={(tabId, direction) => {
            void browser.act({ operation: "browser.navigate", tabId, direction });
          }}
          onOpenAddress={(url, tabId) => {
            if (tabId) void browser.act({ operation: "browser.load", tabId, url });
            else void open(url);
          }}
          onTakeControl={(tabId) => {
            void browser.act({ operation: "browser.take", tabId });
          }}
          onReleaseControl={(tabId) => {
            void browser.act({ operation: "browser.release", tabId });
          }}
          onComputer={
            viewer.canOpen
              ? () => {
                  setMode("computer");
                  computer.refresh();
                  computer.openViewer();
                }
              : undefined
          }
          onBack={() => onClose?.()}
          error={browser.error}
          page={
            active && canView ? (
              <BrowserViewer
                key={active.id}
                environmentId={environmentId}
                hostId={hostId}
                tabId={active.id}
                interactive={active.userControl === true}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
