import { WS_METHODS } from "@t3tools/contracts";
import { request } from "../../rpc/client.ts";

export const readHostStatus = () => request(WS_METHODS.openbotStatus, {});
export const listAgents = () => request(WS_METHODS.openbotListAgents, {});

import type { OpenbotReadRequest } from "@t3tools/contracts";
export const read = (input: OpenbotReadRequest) => request(WS_METHODS.openbotRead, input);

import type { OpenbotCodingListInput } from "@t3tools/contracts";
export const codingTasks = (input: OpenbotCodingListInput) =>
  request(WS_METHODS.openbotCodingList, input);

export const sledToolsStatus = () => request(WS_METHODS.openbotSledToolsStatus, {});

export const attentionSnapshot = () => request(WS_METHODS.openbotAttention, {});
