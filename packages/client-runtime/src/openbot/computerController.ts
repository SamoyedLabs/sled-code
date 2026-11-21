import type { OpenbotComputerAdminRequest } from "@t3tools/contracts";
export type ComputerActions = {
  readonly viewer?: {
    readonly canOpen: boolean;
    readonly open: () => Promise<{
      id: string;
      url: string;
      canClose: () => boolean;
      close: () => Promise<void>;
    }>;
  };
  readonly capabilities: () => Promise<unknown>;
  readonly execute: (input: OpenbotComputerAdminRequest) => Promise<unknown>;
  readonly canCheckSetup: boolean;
  readonly canSelectDisplay: (displayId: string) => boolean;
};
