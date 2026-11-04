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
import { listFileDrafts, listWorkspaceFiles, searchConversationFiles } from "./rpc/index.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";

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
    fileDrafts,
    fileMaterialize: createEnvironmentRpcCommand(runtime, {
      label: "Download bot file",
      tag: WS_METHODS.openbotFilesMaterialize,
    }),
    fileUploadDraft: createEnvironmentRpcCommand(runtime, {
      label: "Upload bot file",
      tag: WS_METHODS.openbotFilesUploadDraft,
      onSuccess: refreshDrafts,
    }),
    fileSendDraft: createEnvironmentRpcCommand(runtime, {
      label: "Send bot file",
      tag: WS_METHODS.openbotFilesSendDraft,
      onSuccess: refreshDrafts,
    }),
    fileDiscardDraft: createEnvironmentRpcCommand(runtime, {
      label: "Discard bot file draft",
      tag: WS_METHODS.openbotFilesDiscardDraft,
      onSuccess: refreshDrafts,
    }),
  };
}
