import {
  decodeImportReceipt,
  IMPORT_MAX_BYTES,
  type ImportRequest,
  type ImportReceipt,
} from "@t3tools/contracts/openbot-agent-import";
export type ImportActions = {
  readonly execute: (request: ImportRequest) => Promise<unknown>;
  readonly upload: (file: {
    readonly name: string;
    readonly size: number;
    readonly source: unknown;
  }) => Promise<{ readonly uploadId: string }>;
};
export type ImportState = {
  readonly receipt: ImportReceipt | null;
  readonly busy: boolean;
  readonly notice: string;
  readonly keys: readonly string[];
  readonly channelKeys: readonly string[];
  readonly uncertain: boolean;
};
export function createAgentImport(hostId: string, actions: ImportActions) {
  let state: ImportState = {
    receipt: null,
    busy: false,
    notice: "",
    keys: [],
    channelKeys: [],
    uncertain: false,
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<ImportState>) => {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  };
  async function run(request: ImportRequest) {
    if (state.busy) return;
    update({ busy: true, notice: "" });
    try {
      const receipt = decodeImportReceipt(await actions.execute(request));
      const changed = receipt?.token !== state.receipt?.token;
      update({
        receipt,
        uncertain: false,
        ...(changed ? { keys: [], channelKeys: [] } : {}),
        notice:
          receipt?.state === "uncertain"
            ? "Import outcome is uncertain. Inspect host agents and channels; this import will not be replayed."
            : "",
      });
    } catch {
      update({
        uncertain: true,
        notice:
          "Connection or request failed. Refresh import status before continuing. Do not upload or apply again.",
      });
    } finally {
      update({ busy: false });
    }
  }
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    refresh: () => run({ operation: "import.status", hostId }),
    async stage(file: { name: string; size: number; source: unknown }, requestId: string) {
      if (state.busy || state.uncertain || (state.receipt && state.receipt.state !== "discarded"))
        return;
      if (
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        file.size > IMPORT_MAX_BYTES ||
        !file.name.toLowerCase().endsWith(".zip")
      ) {
        update({ notice: "Choose a ZIP archive up to 100 MiB." });
        return;
      }
      update({ busy: true, notice: "Uploading archive…" });
      try {
        const upload = await actions.upload(file);
        update({ busy: false });
        await run({ operation: "import.stage", hostId, uploadId: upload.uploadId, requestId });
      } catch {
        update({
          busy: false,
          uncertain: true,
          notice: "Upload interrupted. Refresh status before choosing the archive again.",
        });
      }
    },
    select(kind: "keys" | "channelKeys", key: string) {
      if (state.busy || state.uncertain || state.receipt?.state !== "staged") return;
      const rows = kind === "keys" ? state.receipt.preview.agents : state.receipt.preview.channels;
      if (!rows.some((row) => row.key === key)) return;
      update({
        [kind]: state[kind].includes(key)
          ? state[kind].filter((value) => value !== key)
          : [...state[kind], key],
      });
    },
    apply(timezone: string) {
      if (state.uncertain || state.receipt?.state !== "staged" || !state.keys.length)
        return Promise.resolve();
      return run({
        operation: "import.apply",
        hostId,
        token: state.receipt.token,
        keys: state.keys,
        channelKeys: state.channelKeys,
        timezone,
      });
    },
    discard() {
      if (
        state.uncertain ||
        !state.receipt ||
        !["staged", "complete"].includes(state.receipt.state)
      )
        return Promise.resolve();
      return run({ operation: "import.discard", hostId, token: state.receipt.token });
    },
  };
}
export type AgentImportController = ReturnType<typeof createAgentImport>;

export { IMPORT_INSTRUCTIONS } from "./importInstructions.ts";
