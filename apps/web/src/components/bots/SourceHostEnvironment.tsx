import {
  MarketplaceDraftDialog,
  type MarketplaceDraftRequest,
} from "./upstream/marketplace/MarketplaceDraftDialog";
import { readPreparedConnection } from "../../state/session";
import { InstanceTransferSettings } from "./upstream/transfer/InstanceTransferSettings";
import { BrowserProfilesSettings } from "./upstream/browser/BrowserProfilesSettings";
import { useSourceSettingsActions } from "./SourceSettingsActions";
export { useSourceSettingsActions } from "./SourceSettingsActions";
import * as Option from "effect/Option";
import { usePreparedConnection } from "../../state/session";
import { useSourceMarketplaceApps } from "./SourceMarketplaceApps";
import { useContext, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAgent } from "@t3tools/contracts";
import { templateIsRead } from "@t3tools/contracts/openbot-templates";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Marketplace } from "./upstream/marketplace/Marketplace";
import { SourceHostStorage } from "./upstream/files/SourceHostStorage";
import { SourceHostProviders } from "./upstream/provider/SourceHostProviders";
import { HostSettingsPage } from "./upstream/settings/HostSettingsPage";
import { HostGeneralSettings } from "./upstream/settings/HostGeneralSettings";
import { SourceHostMcpEnvironment } from "./SourceHostMcpEnvironment";
import { BotVault } from "../settings/BotVault";
import { DataEnvironment } from "../settings/DataEnvironment";
import { ComputerEnvironment } from "../settings/ComputerEnvironment";
import { BotRoutineFlows } from "./BotRoutineFlows";
import { TemplateEnvironment } from "../settings/TemplateEnvironment";
import { useGT } from "gt-react";
type MarketplaceScope = {
  environmentId: EnvironmentId;
  hostId: string;
  agents: readonly (typeof OpenbotAgent.Type)[];
  onOpenAgent: (id: string) => void;
  onSignIn?: () => void;
  activeAgentId?: string | undefined;
  onCompose?: ((agentId: string, text: string) => boolean) | undefined;
};
export function SourceMarketplace(props: MarketplaceScope) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <MarketplaceHost
      key={JSON.stringify([props.environmentId, props.hostId, session.epoch])}
      {...props}
    />
  );
}
function MarketplaceHost({
  environmentId,
  hostId,
  agents,
  onOpenAgent,
  onSignIn,
  activeAgentId,
  onCompose,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agents: readonly (typeof OpenbotAgent.Type)[];
  onOpenAgent: (id: string) => void;
  onSignIn?: () => void;
  activeAgentId?: string | undefined;
  onCompose?: ((agentId: string, text: string) => boolean) | undefined;
}) {
  const gt = useGT();
  const connection = Option.getOrNull(usePreparedConnection(environmentId));
  const [draftRequest, setDraftRequest] = useState<MarketplaceDraftRequest | null>(null);
  const requestDraft = onCompose ? setDraftRequest : undefined;
  const apps = useSourceMarketplaceApps({
    environmentId,
    hostId,
    ...(requestDraft
      ? { onPrompt: (text) => requestDraft({ title: gt("Try this app"), text }) }
      : {}),
  });
  const { actions, capabilities } = useSourceSettingsActions(environmentId, hostId),
    registry = useContext(RegistryContext);
  const canRead = useAtomValue(
    openbot.templateRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "templates.preview", agentId: "permission-check" },
    }),
  );
  const canWrite = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "templates.publish", agentId: "permission-check" },
    }),
  );
  const read = useAtomCommand(openbot.templateRead, { reportFailure: false }),
    admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  return (
    <>
      {draftRequest && onCompose && (
        <MarketplaceDraftDialog
          request={draftRequest}
          agents={agents}
          activeAgentId={activeAgentId}
          onClose={() => setDraftRequest(null)}
          onCompose={(agentId, text) =>
            Boolean(
              connection &&
              readPreparedConnection(environmentId) === connection &&
              agents.some((agent) => agent.id === agentId) &&
              onCompose(agentId, text),
            )
          }
        />
      )}
      <Marketplace
        key={capabilities.includes("sled-public-catalog-v1") ? "public" : "hosted"}
        {...apps}
        scopeKey={JSON.stringify([environmentId, hostId])}
        capabilities={capabilities}
        actions={actions}
        agents={agents}
        onOpenAgent={onOpenAgent}
        onDraftRequest={requestDraft}
        {...(onSignIn ? { onSignIn } : {})}
        templates={{
          can: (request) =>
            templateIsRead(request)
              ? canRead &&
                registry.get(
                  openbot.templateRead.permissionAtom(environmentId, { hostId, request }),
                )
              : canWrite &&
                registry.get(
                  openbot.adminToHost.permissionAtom(environmentId, { hostId, request }),
                ),
          execute: async (request) => {
            const result = templateIsRead(request)
              ? await read({ environmentId, input: { hostId, request } })
              : await admin({ environmentId, input: { hostId, request } });
            if (result._tag === "Failure")
              throw Error("The host template request could not be confirmed.");
            return result.value;
          },
        }}
      />
    </>
  );
}
export function SourceHostSettings({
  environmentId,
  hostId,
  hostName,
  initialSection,
  embeddedSection,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  hostName: string;
  initialSection?: import("./upstream/settings/HostSettingsPage").HostSettingsSection;
  embeddedSection?: import("./upstream/settings/HostSettingsPage").HostSettingsSection;
}) {
  const { actions, capabilities } = useSourceSettingsActions(environmentId, hostId);
  return (
    <HostSettingsPage
      {...(embeddedSection ? { embeddedSection } : {})}
      {...(initialSection ? { initialSection } : {})}
      panels={{
        transfer: <InstanceTransferSettings environmentId={environmentId} hostId={hostId} />,
        "browser-profiles": (
          <BrowserProfilesSettings environmentId={environmentId} hostId={hostId} />
        ),
        general: <HostGeneralSettings actions={actions} capabilities={capabilities} />,
        providers: (
          <SourceHostProviders environmentId={environmentId} hostId={hostId} hostName={hostName} />
        ),
        sites: (
          <DataEnvironment environmentId={environmentId} hostId={hostId} view="sites" workspace />
        ),
        vault: <BotVault environmentId={environmentId} hostId={hostId} />,
        storage: (
          <SourceHostStorage environmentId={environmentId} hostId={hostId} hostName={hostName} />
        ),
        desktop: <ComputerEnvironment environmentId={environmentId} hostId={hostId} workspace />,
        import: <TemplateEnvironment environmentId={environmentId} hostId={hostId} />,
        routines: <BotRoutineFlows environmentId={environmentId} hostId={hostId} workspace />,
        mcp: (
          <SourceHostMcpEnvironment
            environmentId={environmentId}
            hostId={hostId}
            hostName={hostName}
          />
        ),
      }}
    />
  );
}
