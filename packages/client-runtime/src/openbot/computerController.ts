import type { OpenbotComputerAdminRequest } from "@t3tools/contracts";
export type ComputerActions = {
  readonly capabilities: () => Promise<unknown>;
  readonly execute: (input: OpenbotComputerAdminRequest) => Promise<unknown>;
  readonly canCheckSetup: boolean;
  readonly canSelectDisplay: (displayId: string) => boolean;
};
