import type { ReactNode } from "react";
import type { OpenbotBrowserTab } from "@t3tools/contracts";
import type { BrowserHistoryEntry } from "./browser-suggestions";
import type { BrowserShortcutPlatform } from "./browser-view-shortcuts";
export type BrowserTab = typeof OpenbotBrowserTab.Type;
export interface BrowserViewProps {
  tabs: readonly BrowserTab[];
  activeTab: BrowserTab | undefined;
  history: readonly BrowserHistoryEntry[];
  canReopen: boolean;
  canControl: boolean;
  canCloseTabs: boolean;
  ownerForTab?: (tab: BrowserTab) => ReactNode;
  profileForTab?: (tab: BrowserTab) => { name: string | null; hue: number | null } | undefined;
  onActivateTab: (id: string) => void;
  onCloseTabs: (ids: readonly string[]) => void;
  onNewTab: (afterId?: string) => Promise<unknown>;
  onDuplicateTab: (id: string) => void;
  onMoveTab: (id: string, index: number) => void;
  onReopenTab: () => void;
  onReload: (id: string) => void;
  onStop: (id: string) => void;
  onNavigate: (id: string, direction: "back" | "forward") => void;
  onOpenAddress: (url: string, id: string | undefined) => void;
  onBack: () => void;
  onTakeControl?: (id: string) => void;
  onReleaseControl?: (id: string) => void;
  onComputer?: (() => void) | undefined;
  shortcuts?: BrowserShortcutPlatform;
  page: ReactNode;
  error?: string | null;
}
export function browserTabStoppable(tab: BrowserTab | undefined) {
  return tab?.loading === true && tab.canGoBack !== undefined;
}
