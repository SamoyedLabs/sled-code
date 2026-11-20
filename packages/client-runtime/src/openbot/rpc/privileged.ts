import { WS_METHODS } from "@t3tools/contracts";
import { request } from "../../rpc/client.ts";
export const privilegedScope = (input: { hostId: string }) =>
  request(WS_METHODS.openbotPrivilegedScope, input);
