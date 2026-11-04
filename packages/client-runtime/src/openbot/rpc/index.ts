import { WS_METHODS, type OpenbotHostReadInput } from "@t3tools/contracts";
import { request, requestGuarded } from "../../rpc/client.ts";

export const readHostStatus = () => request(WS_METHODS.openbotStatus, {});
export const readRuntimeStatus = () => request(WS_METHODS.openbotUpstreamStatus, {});
export const readMaintenanceStatus = () => requestGuarded(WS_METHODS.openbotMaintenanceStatus, {});
export const listAgents = () => request(WS_METHODS.openbotListAgents, {});

import type { OpenbotReadRequest } from "@t3tools/contracts";
export const read = (input: OpenbotReadRequest) => request(WS_METHODS.openbotRead, input);

import type { OpenbotCodingListInput } from "@t3tools/contracts";
export const codingTasks = (input: OpenbotCodingListInput) =>
  request(WS_METHODS.openbotCodingList, input);

export const sledToolsStatus = () => request(WS_METHODS.openbotSledToolsStatus, {});

export const attentionSnapshot = () => request(WS_METHODS.openbotAttention, {});
export const readFromHost = (input: OpenbotHostReadInput) =>
  request(WS_METHODS.openbotReadToHost, input);

import type {
  OpenbotFileScope,
  OpenbotWorkspaceListInput,
  OpenbotConversationFileSearchInput,
} from "@t3tools/contracts";
export const listWorkspaceFiles = (input: OpenbotWorkspaceListInput) =>
  request(WS_METHODS.openbotFilesListWorkspace, input);
export const searchConversationFiles = (input: OpenbotConversationFileSearchInput) =>
  request(WS_METHODS.openbotFilesSearch, input);
export const listFileDrafts = (input: OpenbotFileScope) =>
  request(WS_METHODS.openbotFilesListDrafts, input);

import type { OpenbotCodingPolicyScope } from "@t3tools/contracts";
export const readCodingPolicy = (input: OpenbotCodingPolicyScope) =>
  request(WS_METHODS.openbotCodingPolicyGet, input);
