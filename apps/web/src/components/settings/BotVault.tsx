import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  OpenbotVaultImportResult,
  type EnvironmentId,
  type OpenbotVaultRequest,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { useEnvironmentQuery } from "../../state/query";
import { useBotVault } from "./useBotVault";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { readPreparedConnection, usePreparedConnection } from "../../state/session";
import { VaultPanel } from "../bots/upstream/vault/VaultPanel";
import { T, useGT } from "gt-react";
const decodeImport = Schema.decodeUnknownSync(OpenbotVaultImportResult);
export function BotVault(props: { environmentId: EnvironmentId; hostId: string }) {
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const [session, setSession] = useState({ connection, epoch: 0 });
  if (session.connection !== connection) setSession({ connection, epoch: session.epoch + 1 });
  return <VaultHost key={`${props.environmentId}:${props.hostId}:${session.epoch}`} {...props} />;
}
function VaultHost({ environmentId, hostId }: { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const version = capabilities.includes("vault-v2") ? "v2" : "v1";
  const supported = capabilities.includes("vault-v2") || capabilities.includes("vault-v1");
  const registry = useContext(RegistryContext);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const current = readPreparedConnection(environmentId);
  const active = useRef(true),
    importPicker = useRef<HTMLInputElement>(null),
    pendingImport = useRef<((file: File | null) => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fence private values and settle a cancelled import when the host session closes.
  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;

      pendingImport.current?.(null);
    };
  }, []);
  const execute = async (request: OpenbotVaultRequest) => {
    if (!active.current || !current || readPreparedConnection(environmentId) !== current)
      throw new Error("Reconnect the original vault session.");
    if (!registry.get(openbot.adminToHost.permissionAtom(environmentId, { hostId, request })))
      throw new Error("You don’t have permission to change this vault.");
    const result = await admin({ environmentId, input: { hostId, request } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    if (!active.current || readPreparedConnection(environmentId) !== current)
      throw new Error("The original vault session changed.");
    return result.value;
  };
  const c = useBotVault(async (request) => {
    try {
      return { ok: true, value: await execute(request) };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : gt("Vault request failed."),
      };
    }
  });
  const canList = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "vault.list", version },
    }),
  );
  const canImport = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "vault.import", csv: "" },
    }),
  );
  const load = useEffectEvent(async (version: "v1" | "v2") => {
    await c.run({ operation: "vault.list", version });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the host vault after the exact list permission becomes available.
  useEffect(() => {
    if (canList && supported) void load(version);
  }, [canList, supported, version]);
  const run = async (request: OpenbotVaultRequest) => {
    if (!(await c.run(request))) throw new Error("The vault change could not be confirmed.");
  };
  const reveal = async (request: {
    id: string;
    field: "password" | "number" | "securityCode" | "key";
  }) => {
    if (version === "v1" && request.field === "key")
      throw new Error("This host does not support saved API keys.");
    const revealRequest: OpenbotVaultRequest =
      version === "v2"
        ? { operation: "vault.reveal", version, ...request }
        : {
            operation: "vault.reveal",
            version,
            id: request.id,
            field: request.field === "key" ? "password" : request.field,
          };
    let value = "";
    if (
      !(await c.run(revealRequest, (secret) => {
        value = secret;
      }))
    )
      throw new Error("Could not reveal the saved value.");
    if (!active.current || readPreparedConnection(environmentId) !== current)
      throw new Error("The original vault session changed.");
    return value;
  };
  const importCsv = async () => {
    const file = await new Promise<File | null>((resolve) => {
      pendingImport.current = resolve;
      importPicker.current?.click();
    });
    pendingImport.current = null;
    if (!file) return null;
    if (file.size > 1_048_576)
      throw new Error("Choose a CSV export with no more than 262,144 characters.");
    const csv = await file.text();
    if (!active.current || readPreparedConnection(environmentId) !== current)
      throw new Error("The original vault session changed.");
    if (csv.length > 262_144)
      throw new Error("Choose a CSV export with no more than 262,144 characters.");
    const result = decodeImport(await execute({ operation: "vault.import", csv }));
    await c.run({ operation: "vault.list", version });
    return result;
  };
  if (!compatibility.data)
    return (
      <p role="status">
        <T>Loading vault…</T>
      </p>
    );
  if (!supported)
    return (
      <p role="status">
        <T>This host does not support a vault.</T>
      </p>
    );
  if (!canList)
    return (
      <p role="status">
        <T>You don’t have permission to view this host’s vault.</T>
      </p>
    );
  return (
    <>
      <input
        ref={(element) => {
          importPicker.current = element;
          if (!element) return;
          const cancel = () => pendingImport.current?.(null);
          element.addEventListener("cancel", cancel);
          return () => element.removeEventListener("cancel", cancel);
        }}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label={gt("Choose password export CSV")}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          pendingImport.current?.(file);
        }}
      />
      {!c.state ? (
        <p role={c.error ? "alert" : "status"}>{c.error ?? gt("Loading vault…")}</p>
      ) : (
        <VaultPanel
          state={c.state}
          apiKeys={version === "v2"}
          busy={c.busy}
          error={c.error}
          notice={c.notice}
          onSave={(input) => {
            if (version === "v2") return run({ operation: "vault.save", version, input });
            if (input.kind === "apiKey")
              return Promise.reject(new Error("This host does not support saved API keys."));
            return run({ operation: "vault.save", version, input });
          }}
          onDelete={(id) => run({ operation: "vault.delete", version, id })}
          onReveal={reveal}
          onCopy={(request) =>
            navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": reveal(request).then(
                  (value) => new Blob([value], { type: "text/plain" }),
                ),
              }),
            ])
          }
          onCopyText={(value) => navigator.clipboard.writeText(value)}
          onImportCsv={
            canImport && capabilities.includes("vault-import-v1") ? importCsv : undefined
          }
          onReset={() => run({ operation: "vault.reset", version })}
        />
      )}
    </>
  );
}
