import {
  WS_METHODS,
  type EnvironmentId,
  type OpenbotConversationFileSearchInput,
  type OpenbotFileScope,
  type OpenbotWorkspaceListInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  fileContext,
  importContext,
  listFileDrafts,
  listWorkspaceFiles,
  searchConversationFiles,
} from "./rpc/index.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { mFallback, msg } from "gt-i18n";

export function createOpenbotFileAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  refreshTrigger: (target: { readonly environmentId: EnvironmentId }) => Atom.Atom<unknown>,
) {
  const fileDrafts = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:file-drafts",
    execute: (input: OpenbotFileScope) => listFileDrafts(input),
    staleTimeMs: 5_000,
    refreshTrigger,
  });
  const refreshDrafts = (
    {
      environmentId,
      input,
    }: { readonly environmentId: EnvironmentId; readonly input: OpenbotFileScope },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() =>
      registry.refresh(
        fileDrafts({ environmentId, input: { hostId: input.hostId, agentId: input.agentId } }),
      ),
    );
  return {
    newTaskStart: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Start a new bot thread")),
      tag: WS_METHODS.openbotNewTaskStart,
    }),
    instanceTransfer: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Transfer server agents and settings")),
      tag: WS_METHODS.openbotInstanceTransfer,
    }),
    queueAttachmentContext: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Read acquired queue revision")),
      tag: WS_METHODS.openbotQueueAttachmentContext,
    }),
    queueAttachmentSave: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Save queued message attachments")),
      tag: WS_METHODS.openbotQueueAttachmentSave,
      onSuccess: refreshDrafts,
    }),
    queueAttachmentResult: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Recover queued message edit")),
      tag: WS_METHODS.openbotQueueAttachmentResult,
      onSuccess: refreshDrafts,
    }),
    fileWorkspace: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:workspace-files",
      execute: (input: OpenbotWorkspaceListInput) => listWorkspaceFiles(input),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    fileSearch: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:conversation-files",
      execute: (input: OpenbotConversationFileSearchInput) => searchConversationFiles(input),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    importContext: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:import-context",
      execute: (input: { hostId: string }) => importContext(input),
      staleTimeMs: 0,
      refreshTrigger,
    }),
    fileContext: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:file-context",
      execute: (input: { hostId: string }) => fileContext(input),
      staleTimeMs: 0,
      refreshTrigger,
    }),
    importExecute: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Import bot archive")),
      tag: WS_METHODS.openbotImportExecute,
    }),
    archiveUpload: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Upload bot archive")),
      tag: WS_METHODS.openbotArchiveUpload,
    }),
    fileDrafts,
    fileMaterialize: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Download bot file")),
      tag: WS_METHODS.openbotFilesMaterialize,
    }),
    fileOriginalUpload: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Stage bot attachment")),
      tag: WS_METHODS.openbotFilesOriginalUpload,
    }),
    fileRecoverUpload: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Recover bot attachment")),
      tag: WS_METHODS.openbotFilesRecoverUpload,
    }),
    fileCancelUpload: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Cancel bot attachment")),
      tag: WS_METHODS.openbotFilesCancelUpload,
    }),
    fileUploadDraft: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Upload bot file")),
      tag: WS_METHODS.openbotFilesUploadDraft,
      onSuccess: refreshDrafts,
    }),
    fileSendDraft: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Send bot file")),
      tag: WS_METHODS.openbotFilesSendDraft,
      onSuccess: refreshDrafts,
    }),
    fileDiscardDraft: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Discard bot file draft")),
      tag: WS_METHODS.openbotFilesDiscardDraft,
      onSuccess: refreshDrafts,
    }),
  };
}
