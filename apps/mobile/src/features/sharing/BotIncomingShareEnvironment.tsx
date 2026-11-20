import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  BotShareDestination,
  BotSharePorts,
} from "@t3tools/client-runtime/openbot/incoming-share";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentSession } from "../../state/session";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { Button } from "../../components/ui/Button";
import { AppText } from "../../components/ui/AppText";
import { BotIncomingShare } from "./BotIncomingShare";
import { createIncomingBotSharePorts } from "./incoming-bot-share";
import {
  incomingShareInbox,
  publishIncomingShares,
  useIncomingShare,
} from "./IncomingShareProvider";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  threadId: string;
  taskId: string | null;
};
export function BotIncomingShareEnvironment(props: Props) {
  return <ShareScope key={JSON.stringify(props)} {...props} />;
}
function ShareScope({ environmentId, hostId, agentId, threadId, taskId }: Props) {
  const { pendingShare } = useIncomingShare();
  const context = useAtomQueryRunner(openbot.fileContext, { refresh: true, reportFailure: false });
  const list = useAtomQueryRunner(openbot.fileDrafts, { refresh: true, reportFailure: false });
  const upload = useAtomCommand(openbot.fileOriginalUpload, { reportFailure: false });
  const recover = useAtomCommand(openbot.fileRecoverUpload, { reportFailure: false });
  const cancel = useAtomCommand(openbot.fileCancelUpload, { reportFailure: false });
  const send = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const discard = useAtomCommand(openbot.fileDiscardDraft, { reportFailure: false });
  const permission = useAtomValue(openbot.fileOriginalUpload.permissionAtom(environmentId));
  const sendPermission = useAtomValue(openbot.fileSendDraft.permissionAtom(environmentId));
  const auth = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  const alive = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Revokes in-flight native upload callbacks when the selected conversation unmounts.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [panel, setPanel] = useState<{
    shareId: string;
    destination: BotShareDestination;
    ports: BotSharePorts;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const session = AsyncResult.getOrElse(auth, () => null);
  const authenticated = auth._tag !== "Failure" && session?.authenticated;
  async function choose() {
    if (!pendingShare || pendingShare.destination || busy) return;
    const shareId = pendingShare.id;
    const connection = Option.getOrNull(
      appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    if (!connection) return;
    setBusy(true);
    setNotice("");
    await (async () => {
      const identity = await context({ environmentId, input: { hostId } });
      if (identity._tag === "Failure") throw squashAtomCommandFailure(identity);
      const destination: BotShareDestination = {
        environmentId,
        principalId: identity.value.principalId,
        hostId,
        agentId,
        threadId,
        target: taskId ? { kind: "task", taskId } : { kind: "main" },
      };
      const current = () => {
        const state = appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId));
        const value = AsyncResult.getOrElse(state, () => null);
        const selected = Option.getOrNull(
          appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
        );
        return alive.current &&
          selected === connection &&
          state._tag !== "Failure" &&
          value?.authenticated &&
          (!value.expiresAt || value.expiresAt.epochMilliseconds > Date.now())
          ? destination
          : null;
      };
      const check = () => {
        if (!current())
          throw new Error(
            "The selected conversation or signed-in session changed. Reopen the shared content.",
          );
      };
      const run = async <T,>(action: () => Promise<T>) => {
        check();
        const fresh = await context({ environmentId, input: { hostId } });
        check();
        if (fresh._tag === "Failure") throw squashAtomCommandFailure(fresh);
        if (fresh.value.principalId !== destination.principalId)
          throw new Error("The signed-in session changed. The original share is retained.");
        const value = await action();
        check();
        return value;
      };
      const ports = createIncomingBotSharePorts({
        inbox: incomingShareInbox,
        shareId,
        destination,
        publish: publishIncomingShares,
        current,
        list: () =>
          run(async () => {
            const r = await list({ environmentId, input: { hostId, agentId } });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
            return r.value;
          }),
        send: (input) =>
          run(async () => {
            const r = await send({ environmentId, input });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
            return r.value;
          }),
        discard: (input) =>
          run(async () => {
            const r = await discard({
              environmentId,
              input: { hostId, agentId, attachmentId: input },
            });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
          }),
        uploadDraft: async () => {
          throw new Error("Original upload identity is required.");
        },
        originalUpload: (input) =>
          run(async () => {
            const r = await upload({
              environmentId,
              input: { ...input, principalId: destination.principalId },
            });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
            return r.value;
          }),
        recoverUpload: (input) =>
          run(async () => {
            const r = await recover({
              environmentId,
              input: { ...input, principalId: destination.principalId },
            });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
            return r.value;
          }),
        cancelUpload: (input) =>
          run(async () => {
            const r = await cancel({
              environmentId,
              input: { ...input, principalId: destination.principalId },
            });
            if (r._tag === "Failure") throw squashAtomCommandFailure(r);
            return r.value;
          }),
      });
      check();
      setPanel({ shareId, destination, ports });
    })()
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Shared content could not be opened.");
      })
      .finally(() => {
        setBusy(false);
      });
  }
  if (!pendingShare || pendingShare.destination) return null;
  return (
    <View className="gap-3">
      <AppText>
        Shared content is waiting. Choose this conversation to review it before sending.
      </AppText>
      <Button
        label={busy ? "Checking destination…" : "Use this bot conversation"}
        disabled={busy || !authenticated || !permission || !sendPermission}
        onPress={() => void choose()}
      />
      {notice && <AppText accessibilityRole="alert">{notice}</AppText>}
      {panel &&
        panel.shareId === pendingShare.id &&
        authenticated &&
        permission &&
        sendPermission && (
          <BotIncomingShare
            share={pendingShare}
            destination={panel.destination}
            destinationLabel={`${agentId} · ${taskId ? "task" : "main conversation"}`}
            ports={panel.ports}
          />
        )}
    </View>
  );
}
