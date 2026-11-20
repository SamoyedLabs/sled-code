import { useStableCallback } from "../../../../hooks/useStableCallback";
/* oxlint-disable shadcn/no-unknown-classes -- Source transfer selectors are provided by scoped styles. */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  type EnvironmentId,
  OpenbotMaterializedFile,
  OpenbotArchiveUpload,
} from "@t3tools/contracts";
import {
  OpenbotTransferSummary,
  OpenbotTransferReceipt,
  OpenbotPendingTransfer,
  type OpenbotTransferCommand,
} from "@t3tools/contracts/openbot-instance-transfer";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { assetEnvironment } from "../../../../state/assets";
import { readPreparedConnection } from "../../../../state/session";
import { downloadMedia } from "../../../media/mediaContent";
import { randomUUID } from "../../../../lib/utils";
import { InstanceTransferView, type InstanceTransferScreen } from "./InstanceTransferView";
import { SourceButton } from "../settings/SettingsParts";
const decodeSummary = Schema.decodeUnknownSync(OpenbotTransferSummary),
  decodeReceipt = Schema.decodeUnknownSync(Schema.NullOr(OpenbotTransferReceipt));
const decodeArchiveUpload = Schema.decodeUnknownSync(OpenbotArchiveUpload);
const decodePending = Schema.decodeUnknownSync(OpenbotPendingTransfer);
const decodeExport = Schema.decodeUnknownSync(Schema.Struct({ file: OpenbotMaterializedFile }));
const decodeRetained = Schema.decodeUnknownSync(
  Schema.Struct({
    requestId: Schema.String,
    keys: Schema.optional(Schema.Array(Schema.String)),
    includeSettings: Schema.optional(Schema.Boolean),
    timezone: Schema.optional(Schema.String),
  }),
);
type Receipt = OpenbotTransferReceipt;
export function InstanceTransferSettings(props: { environmentId: EnvironmentId; hostId: string }) {
  return (
    <TransferEnvironment key={JSON.stringify([props.environmentId, props.hostId])} {...props} />
  );
}
function TransferEnvironment({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const command = useAtomCommand(openbot.instanceTransfer, { reportFailure: false }),
    context = useAtomQueryRunner(openbot.fileContext, {
      reportFailure: false,
      reportDefect: false,
      refresh: true,
    });

  const asset = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    reportDefect: false,
  });
  const permission = useAtomValue(openbot.instanceTransfer.permissionAtom(environmentId));
  const [summary, setSummary] = useState<typeof OpenbotTransferSummary.Type | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [screen, setScreen] = useState<InstanceTransferScreen>("home");
  const [busy, setBusy] = useState<"export" | "stage" | "apply" | "refresh" | null>(null),
    [error, setError] = useState<string | null>(null),
    [exported, setExported] = useState(false);
  const [download, setDownload] = useState<{
    file: OpenbotMaterializedFile;
    connection: NonNullable<ReturnType<typeof readPreparedConnection>>;
  } | null>(null);
  const [retained, setRetained] = useState<ReturnType<typeof decodeRetained> | null>(null);
  const storageKey = useRef<string | null>(null),
    principal = useRef<string | null>(null),
    lock = useRef(false),
    alive = useRef(true),
    fileInput = useRef<HTMLInputElement>(null);
  const check = (captured: ReturnType<typeof readPreparedConnection>) => {
    if (!alive.current || !captured || readPreparedConnection(environmentId) !== captured)
      throw Error("The original connection changed. Reopen Transfer to recover its status.");
  };
  const execute = async (
    request: OpenbotTransferCommand,
    captured = readPreparedConnection(environmentId),
  ) => {
    check(captured);
    const result = await command({ environmentId, input: request });
    check(captured);
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  const persist = (value: ReturnType<typeof decodeRetained>) => {
    if (!storageKey.current) throw Error("Open Transfer again before importing.");
    const bytes = JSON.stringify(value);
    window.sessionStorage.setItem(storageKey.current, bytes);
    if (window.sessionStorage.getItem(storageKey.current) !== bytes)
      throw Error("The recovery identity could not be saved. No import was started.");
    setRetained(value);
  };
  const refresh = async () => {
    if (lock.current || !permission) return;
    lock.current = true;
    setBusy("refresh");
    setError(null);
    const captured = readPreparedConnection(environmentId);
    try {
      const bound = await context({ environmentId, input: { hostId } });
      check(captured);
      if (bound._tag === "Failure") throw squashAtomCommandFailure(bound);
      principal.current = bound.value.principalId;
      storageKey.current =
        "sled:openbot:instance-transfer:" +
        JSON.stringify([environmentId, hostId, bound.value.principalId]);
      const stored = window.sessionStorage.getItem(storageKey.current),
        previous = stored ? decodeRetained(JSON.parse(stored)) : null;
      setRetained(previous);
      setSummary(decodeSummary(await execute({ hostId, operation: "summary" }, captured)));
      if (previous) {
        const value = decodeReceipt(
          await execute({ hostId, operation: "recover", requestId: previous.requestId }, captured),
        );
        setReceipt(value);
        setScreen("import");
        if (!value)
          setError(
            "The original transfer has no retained host receipt. It was not automatically replayed.",
          );
      } else {
        const pending = decodePending(await execute({ hostId, operation: "pending" }, captured));
        if (pending) {
          persist({ requestId: pending.requestId });
          setReceipt(pending.receipt);
          setScreen("import");
        }
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const load = useStableCallback(refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the host summary and the original session-bound receipt on mount; this never applies or restages an import.
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Permission acquisition must trigger the read; the stable event wrapper intentionally reads the latest destination callbacks.
  }, [permission, load]);
  const run = async (
    operation: NonNullable<typeof busy>,
    action: (captured: NonNullable<ReturnType<typeof readPreparedConnection>>) => Promise<void>,
  ) => {
    if (lock.current || !permission) return;
    const captured = readPreparedConnection(environmentId);
    if (!captured) return;
    lock.current = true;
    setBusy(operation);
    setError(null);
    try {
      await action(captured);
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (operation === "apply")
          setReceipt((previous) => (previous ? { ...previous, state: "uncertain" } : previous));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const finish = () => {
    if (storageKey.current) window.sessionStorage.removeItem(storageKey.current);
    setRetained(null);
    setReceipt(null);
    setScreen("home");
  };
  const choose = (file: File) =>
    run("stage", async (captured) => {
      if (!principal.current || retained || file.size <= 0 || file.size > 104857600)
        throw Error("Choose a nonempty transfer ZIP up to 100 MiB.");
      const allocated = decodeArchiveUpload(
        await execute({ hostId, operation: "upload", name: file.name, size: file.size }, captured),
      );
      const url = resolveAssetUrl(captured.httpBaseUrl, allocated.relativeUrl);
      if (!url) throw Error("Archive upload is unavailable.");
      const response = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      check(captured);
      if (!response.ok) throw Error("The archive upload did not complete.");
      const requestId = randomUUID();
      persist({ requestId });
      setReceipt(
        decodeReceipt(
          await execute(
            { hostId, operation: "stage", requestId, uploadId: allocated.uploadId },
            captured,
          ),
        ),
      );
    });
  return (
    <section aria-label="Server transfer">
      {!permission && (
        <p role="status">Host settings permission is required to transfer agents and settings.</p>
      )}
      {error && (
        <p role="alert" className="storage-message">
          {error}
        </p>
      )}
      {retained && (
        <SourceButton disabled={!!busy} onClick={() => void refresh()}>
          Recover transfer status
        </SourceButton>
      )}
      {receipt?.state === "uncertain" && (
        <p role="status">
          The original attempt was not confirmed. No agents will be imported again automatically.
          Check the destination’s agents before starting a separate transfer.
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void choose(file);
        }}
      />
      <InstanceTransferView
        screen={screen}
        onScreenChange={setScreen}
        summary={summary}
        exportPhase={busy === "export" ? "exporting" : exported ? "saved" : "options"}
        exportFileName={exported ? "openbot-transfer.zip" : null}
        exportWarnings={[]}
        exportError={null}
        onExport={(options) =>
          void run("export", async (captured) => {
            const value = decodeExport(
              await execute({ hostId, operation: "export", ...options }, captured),
            );
            const minted = await asset({
              environmentId,
              input: {
                resource: {
                  _tag: "attachment",
                  attachmentId: value.file.attachmentId,
                  fileName: value.file.name,
                  mimeType: value.file.mimeType,
                  disposition: "attachment",
                },
              },
            });
            check(captured);
            if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
            const url = resolveAssetUrl(captured.httpBaseUrl, minted.value.relativeUrl);
            if (!url) throw Error("Download unavailable.");
            setDownload({ file: value.file, connection: captured });
            await downloadMedia(url, value.file.name);
            check(captured);
            setExported(true);
          })
        }
        onShowExport={() =>
          void run("export", async (captured) => {
            if (!download || download.connection !== captured)
              throw Error("Reconnect to the original environment before downloading this export.");
            const file = download.file;
            const minted = await asset({
              environmentId,
              input: {
                resource: {
                  _tag: "attachment",
                  attachmentId: file.attachmentId,
                  fileName: file.name,
                  mimeType: file.mimeType,
                  disposition: "attachment",
                },
              },
            });
            check(captured);
            if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
            const url = resolveAssetUrl(captured.httpBaseUrl, minted.value.relativeUrl);
            if (!url) throw Error("Download unavailable.");
            await downloadMedia(url, file.name);
          })
        }
        onExportAgain={() => setExported(false)}
        importPhase={
          busy === "stage"
            ? "reading"
            : busy === "apply"
              ? "importing"
              : receipt?.state === "complete"
                ? "done"
                : receipt?.preview
                  ? "review"
                  : "idle"
        }
        preview={receipt?.preview ?? null}
        result={receipt?.result ?? null}
        importError={null}
        uncertain={
          receipt?.state === "uncertain" ||
          (!!retained && !receipt) ||
          !permission ||
          busy === "refresh"
        }
        onChoose={() => {
          if (!retained && permission && !busy) fileInput.current?.click();
        }}
        onImport={(keys, includeSettings) =>
          void run("apply", async (captured) => {
            if (!receipt?.preview || receipt.state !== "staged" || !retained) return;
            const selected =
              retained.keys === undefined
                ? {
                    ...retained,
                    keys,
                    includeSettings,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }
                : retained;
            persist(selected);
            setReceipt(
              decodeReceipt(
                await execute(
                  {
                    hostId,
                    operation: "apply",
                    token: selected.requestId,
                    keys: selected.keys ?? [],
                    includeSettings: selected.includeSettings ?? false,
                    timezone: selected.timezone ?? "UTC",
                  },
                  captured,
                ),
              ),
            );
          })
        }
        onCancelImport={() =>
          void run("refresh", async (captured) => {
            if (!receipt?.preview || receipt.state !== "staged") return;
            const value = decodeReceipt(
              await execute(
                { hostId, operation: "discard", token: receipt.preview.token },
                captured,
              ),
            );
            if (value?.state === "discarded") finish();
          })
        }
        onImportDone={finish}
      />
    </section>
  );
}
