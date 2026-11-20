import type { ReactNode } from "react";
import type { SettingsActions } from "@t3tools/client-runtime/openbot/settings";
import type { TemplateActions } from "@t3tools/client-runtime/openbot/templates";
import type { Category } from "@t3tools/client-runtime/openbot/marketplace";
export * from "@t3tools/client-runtime/openbot/marketplace";
export type MarketplaceAgent = {
  readonly id: string;
  readonly name: string;
  readonly listingId?: string | undefined;
  readonly avatarSeed?: string | undefined;
  readonly avatarHue?: number | null | undefined;
  readonly avatarUrl?: string | null | undefined;
};
export type MarketplaceApp = {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: Category;
  readonly iconUrl?: string;
  readonly icon?: import("react").ReactNode;
  readonly status: "connected" | "attention" | "connecting" | "idle";
  readonly detail: import("react").ReactNode;
  readonly connect?: () => Promise<void>;
};
export type MarketplaceProps = {
  readonly scopeKey: string;
  readonly capabilities: readonly string[];
  readonly actions: SettingsActions;
  readonly templates: TemplateActions;
  readonly agents: readonly MarketplaceAgent[];
  readonly onOpenAgent?: (agentId: string) => void;
  readonly onDraftRequest?:
    | ((request: import("./MarketplaceDraftDialog").MarketplaceDraftRequest) => void)
    | undefined;
  readonly onClose?: () => void;
  readonly onSignIn?: () => void;
  readonly apps?: readonly MarketplaceApp[];
  readonly appsError?: string;
  readonly appsOverlay?: ReactNode;
  readonly onAddApp?: () => void;
};
