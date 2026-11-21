import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { createAgentImport } from "@t3tools/client-runtime/openbot/agent-import";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { File, UploadType } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentSession, usePreparedConnection } from "../../state/session";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { BotAgentImport } from "./BotAgentImport";
import { Button } from "../../components/ui/Button";
import { T, useGT } from "gt-react-native";

const readPreparedConnection = (environmentId: EnvironmentId) =>
  Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
  );
async function chooseArchive() {
  const { getDocumentAsync } = await import("expo-document-picker");
  const endHandoff = beginForegroundHandoff();
  const picked = await getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: ["application/zip", "application/x-zip-compressed"],
  }).finally(endHandoff);
  if (picked.canceled || !picked.assets[0]) return null;
  const selected = picked.assets[0];
  const source = new File(selected.uri);
  if (!source.exists || !source.size || source.size > 104857600)
    throw new Error("Choose an available ZIP up to 100 MiB.");
  return { name: selected.name, size: source.size, source, requestId: Crypto.randomUUID() };
}
export function BotImportEnvironment({
  environmentId,
  hostId,
  destination,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  destination: string;
}) {
  const gt = useGT();
  const connection = usePreparedConnection(environmentId);
  const auth = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  const permission = useAtomValue(openbot.importExecute.permissionAtom(environmentId));
  const uploadPermission = useAtomValue(openbot.archiveUpload.permissionAtom(environmentId));
  const context = useAtomQueryRunner(openbot.importContext, {
    refresh: true,
    reportFailure: false,
  });
  const execute = useAtomCommand(openbot.importExecute, { reportFailure: false });
  const upload = useAtomCommand(openbot.archiveUpload, { reportFailure: false });
  const [panel, setPanel] = useState<{
    connection: NonNullable<ReturnType<typeof readPreparedConnection>>;
    principalId: string;
    controller: ReturnType<typeof createAgentImport>;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const session = AsyncResult.getOrElse(auth, () => null);
  const expiresAtMs = session?.expiresAt?.epochMilliseconds ?? null;
  const [expiredAtMs, setExpiredAtMs] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Marks the current session expired once its expiry timestamp arrives.
  useEffect(() => {
    if (expiresAtMs === null) return;
    const delay = Math.max(0, expiresAtMs - Date.now());
    const timer = setTimeout(() => setExpiredAtMs(expiresAtMs), delay);
    return () => clearTimeout(timer);
  }, [expiresAtMs]);
  const expired = expiresAtMs !== null && expiredAtMs === expiresAtMs;
  const authenticated = auth._tag !== "Failure" && session?.authenticated && !expired;
  const visible =
    panel &&
    Option.isSome(connection) &&
    panel.connection === connection.value &&
    authenticated &&
    permission &&
    uploadPermission;
  async function show() {
    const prepared = readPreparedConnection(environmentId);
    if (!prepared || busy) return;
    setBusy(true);
    setNotice("");
    await (async () => {
      const result = await context({ environmentId, input: { hostId } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (!result.value.available)
        throw new Error("This host does not support recoverable archive import.");
      const principalId = result.value.principalId;
      const check = () => {
        const current = appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId));
        const state = AsyncResult.getOrElse(current, () => null);
        if (
          readPreparedConnection(environmentId) !== prepared ||
          current._tag === "Failure" ||
          !state?.authenticated ||
          (state.expiresAt && state.expiresAt.epochMilliseconds <= Date.now())
        )
          throw new Error("Import session changed. Reopen import.");
      };
      check();
      const controller = createAgentImport(hostId, {
        execute: async (request) => {
          check();
          const result = await execute({ environmentId, input: { principalId, request } });
          check();
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value;
        },
        upload: async (file) => {
          check();
          if (!(file.source instanceof File)) throw new Error("Choose an archive file.");
          const result = await upload({
            environmentId,
            input: { hostId, principalId, name: file.name, size: file.size },
          });
          check();
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          const url = resolveAssetUrl(prepared.httpBaseUrl, result.value.relativeUrl);
          if (!url) throw new Error("Archive upload unavailable");
          const response = await file.source.upload(url, {
            httpMethod: "PUT",
            uploadType: UploadType.BINARY_CONTENT,
            headers: { "Content-Type": "application/zip" },
          });
          check();
          if (response.status < 200 || response.status >= 300)
            throw new Error("Archive upload interrupted");
          return { uploadId: result.value.uploadId };
        },
      });
      setPanel({ connection: prepared, principalId, controller });
    })()
      .catch((error) => {
        setNotice(String(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return (
    <View className="gap-3">
      <Button
        tone="secondary"
        disabled={busy || !authenticated || !permission || !uploadPermission}
        label={visible ? gt("Close import") : busy ? gt("Checking import…") : gt("Import agents")}
        onPress={() => (visible ? setPanel(null) : void show())}
      />
      {(!permission || !uploadPermission) && (
        <Text>
          <T>Import requires settings, file access, and agent operation permissions.</T>
        </Text>
      )}
      {notice && <Text accessibilityRole="alert">{notice}</Text>}
      {visible && (
        <BotAgentImport
          key={`${environmentId}:${hostId}:${panel.principalId}`}
          controller={panel.controller}
          destination={destination}
          chooseArchive={chooseArchive}
        />
      )}
    </View>
  );
}
