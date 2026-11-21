/* oxlint-disable react/no-unstable-nested-components -- Section content is an invoked render callback, never mounted as a component; the source pane preserves its own page identity. */
import { useContext, useState } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type EnvironmentId, type OpenbotAgent, OpenbotAdminRequest } from "@t3tools/contracts";
import {
  settingIsRead,
  settingRequest,
  settingResult,
  settingsCapabilities,
} from "@t3tools/client-runtime/openbot/settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  BookMarked,
  FileText,
  Folder,
  HardDrive,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
  ArrowLeftRight,
  Clock3,
  Table2,
} from "lucide-react";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { usePreparedConnection, readPreparedConnection } from "../../state/session";
import { SourceModelPicker } from "./SourceProviderEnvironment";
import { useSourceAgentAvatarUrl } from "./SourceAgentAvatar";
import {
  AgentSettingsPanel,
  type AgentSettingsSection,
} from "./upstream/settings/AgentSettingsPanel";
import {
  AgentInstructionsPage,
  AgentPermissionsPage,
  AgentAdvancedPage,
} from "./upstream/settings/AgentConfigurationPages";
import { AgentFoldersPage } from "./upstream/settings/AgentFoldersPage";
import { AgentBackupModelsPage } from "./upstream/settings/AgentBackupModelsPage";
import { AgentSkillsPage } from "./upstream/settings/AgentSkillsPage";
import { type AgentSettingsApi } from "./upstream/settings/agent-settings-api";
import { MemoryEnvironment } from "./upstream/memory/MemoryEnvironment";
import { FilesEnvironment } from "./upstream/files/FilesEnvironment";
import { avatarImageDataUrl } from "./upstream/settings/avatar-image";
import { SourceButton } from "./upstream/settings/SettingsParts";
import { T, useGT } from "gt-react";
const decodeAdmin = Schema.decodeSync(OpenbotAdminRequest);
export interface SourceAgentSettingsProps {
  layout?: "page" | "panel";
  environmentId: EnvironmentId;
  hostId: string;
  agent: typeof OpenbotAgent.Type;
  onClose: () => void;
  onOpenFiles?: ((conversationId?: string, messageId?: string) => void) | undefined;
  onOpenMemory?: (() => void) | undefined;
  onManageProviders?: (() => void) | undefined;
  onOpenSharedTables?: (() => void) | undefined;
  onOpenRoutines?: (() => void) | undefined;
}
export function SourceAgentSettings(props: SourceAgentSettingsProps) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return (
    <Ready
      key={`${props.environmentId}:${props.hostId}:${props.agent.id}:${session.epoch}`}
      {...props}
      connection={connection}
    />
  );
}
function Ready({
  layout,
  environmentId,
  hostId,
  agent,
  onClose,
  onOpenFiles,
  onOpenMemory,
  onManageProviders,
  onOpenSharedTables,
  onOpenRoutines,
  connection,
}: SourceAgentSettingsProps & { connection: ReturnType<typeof readPreparedConnection> }) {
  const gt = useGT();
  const registry = useContext(RegistryContext);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const read = useAtomCommand(openbot.settingsRead, { reportFailure: false });
  const avatarUrl = useSourceAgentAvatarUrl(agent);
  const [fileConversation, setFileConversation] = useState<string | null>(null);
  const canEdit = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "agent.update", agentId: agent.id, input: {} },
    }),
  );
  const canAvatar = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "agent.avatar.set", agentId: agent.id, image: null },
    }),
  );
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const roster = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const fresh = () => {
    if (!connection || readPreparedConnection(environmentId) !== connection)
      throw new Error("Reconnect the original host session before changing this agent.");
  };
  const api: AgentSettingsApi = {
    agentId: agent.id,
    capabilities,
    canAdmin: (request) =>
      Boolean(
        connection &&
        readPreparedConnection(environmentId) === connection &&
        registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })),
      ),
    admin: async (request) => {
      fresh();
      const parsed = decodeAdmin(request);
      if (
        !registry.get(
          openbot.adminToHost.permissionAtom(environmentId, { hostId, request: parsed }),
        )
      )
        throw new Error("You don’t have permission to change this agent.");
      const result = await admin({ environmentId, input: { hostId, request: parsed } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      fresh();
      roster.refresh();
      return result.value;
    },
    setting: async (operation, parameters) => {
      fresh();
      const request = settingRequest(operation, parameters ?? { agentId: agent.id });
      if (!request) throw new Error("The host cannot accept this setting.");
      const result = settingIsRead(request)
        ? await (async () => {
            if (
              !registry.get(openbot.settingsRead.permissionAtom(environmentId, { hostId, request }))
            )
              throw new Error("You don’t have permission to read this setting.");
            return read({ environmentId, input: { hostId, request } });
          })()
        : await (async () => {
            if (
              !registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request }))
            )
              throw new Error("You don’t have permission to change this setting.");
            return admin({ environmentId, input: { hostId, request } });
          })();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      fresh();
      const value = settingResult(operation, result.value);
      if (value === null) throw new Error("The host returned an unsupported setting response.");
      return value;
    },
  };
  const sections: AgentSettingsSection[] = [
    {
      id: "instructions",
      label: gt("Instructions"),
      icon: <FileText aria-hidden="true" />,
      group: "Knows",
      fullPage: true,
      content: (onBack) => <AgentInstructionsPage api={api} onBack={onBack} onClose={onClose} />,
    },
    {
      id: "memory",
      onOpen: onOpenMemory,
      label: gt("Memory"),
      icon: <BookMarked aria-hidden="true" />,
      group: "Knows" as const,
      fullPage: true,
      content: (onBack: () => void) => (
        <MemoryEnvironment
          environmentId={environmentId}
          hostId={hostId}
          agentId={agent.id}
          agentName={agent.name}
          onBack={onBack}
          onClose={onClose}
        />
      ),
    },
    ...(onOpenSharedTables
      ? [
          {
            id: "shared-tables",
            label: gt("Shared tables"),
            icon: <Table2 aria-hidden="true" />,
            group: "Knows" as const,
            onOpen: onOpenSharedTables,
            content: null,
          },
        ]
      : []),
    ...(onOpenRoutines
      ? [
          {
            id: "routines",
            label: gt("Routines"),
            icon: <Clock3 aria-hidden="true" />,
            group: "Does" as const,
            onOpen: onOpenRoutines,
            content: null,
          },
        ]
      : []),
    ...(capabilities.includes("storage-v1")
      ? [
          {
            id: "files",
            onOpen: onOpenFiles ? () => onOpenFiles() : undefined,
            label: gt("Files"),
            icon: <HardDrive aria-hidden="true" />,
            group: "Knows" as const,
            fullPage: true,
            content: (onBack: () => void) => (
              <FilesEnvironment
                environmentId={environmentId}
                hostId={hostId}
                agentId={agent.id}
                agentName={agent.name}
                {...(fileConversation
                  ? { conversation: { id: fileConversation, title: gt("Conversation files") } }
                  : {})}
                onBack={() => (fileConversation ? setFileConversation(null) : onBack())}
                onClose={onClose}
                onOpenConversation={setFileConversation}
                onShowMessage={() => {
                  throw new Error("Open the agent conversation to locate this message.");
                }}
              />
            ),
          },
        ]
      : []),
    ...(capabilities.includes("skills-admin-v1")
      ? [
          {
            id: "skills",
            label: gt("Skills"),
            icon: <Puzzle aria-hidden="true" />,
            group: "Does" as const,
            fullPage: true,
            content: (onBack: () => void) => (
              <AgentSkillsPage api={api} onBack={onBack} onClose={onClose} />
            ),
          },
        ]
      : []),
    {
      id: "permissions",
      label: gt("Permissions"),
      icon: <ShieldCheck aria-hidden="true" />,
      group: "Rules",
      content: <AgentPermissionsPage api={api} />,
    },
    ...(capabilities.includes("agent-folders-v1")
      ? [
          {
            id: "folders",
            label: gt("Folders"),
            icon: <Folder aria-hidden="true" />,
            group: "Rules" as const,
            content: <AgentFoldersPage api={api} />,
          },
        ]
      : []),
    {
      id: "advanced",
      label: gt("Advanced"),
      icon: <SlidersHorizontal aria-hidden="true" />,
      group: "Rules",
      content: <AgentAdvancedPage api={api} />,
    },
    ...(capabilities.includes("agent-backup-models-v1")
      ? [
          {
            id: "backup-models",
            label: gt("Backup models"),
            icon: <ArrowLeftRight aria-hidden="true" />,
            group: "Brain" as const,
            content: (
              <AgentBackupModelsPage
                api={api}
                agentName={agent.name}
                ownProvider={agent.provider}
              />
            ),
          },
        ]
      : []),
  ];
  if (compatibility.error)
    return (
      <p role="alert">
        {compatibility.error}
        <SourceButton onClick={compatibility.refresh}>
          <T>Retry</T>
        </SourceButton>
      </p>
    );
  return (
    <AgentSettingsPanel
      layout={layout}
      agent={{
        id: agent.id,
        name: agent.name,
        title: agent.title ?? "",
        description: agent.description ?? "",
        avatarSeed: agent.avatarSeed ?? agent.id,
        avatarHue: agent.avatarHue ?? null,
        avatarUrl,
      }}
      onClose={onClose}
      onUpdateAgent={
        canEdit
          ? async (agentId, input) => {
              await api.admin({ operation: "agent.update", agentId, input });
            }
          : undefined
      }
      onSetAgentAvatar={
        canAvatar
          ? async (agentId, image) => {
              await api.admin({
                operation: "agent.avatar.set",
                agentId,
                image: image
                  ? {
                      mimeType: image.mimeType,
                      dataBase64: avatarImageDataUrl(image).split(",")[1] ?? "",
                    }
                  : null,
              });
            }
          : undefined
      }
      brain={
        <SourceModelPicker
          environmentId={environmentId}
          hostId={hostId}
          agentId={agent.id}
          variant="field"
          onManage={onManageProviders}
        />
      }
      sections={sections}
    />
  );
}
