import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  createBotShareTransfer,
  botShareRecovery,
  type BotShareDestination,
  type BotSharePorts,
} from "@t3tools/client-runtime/openbot/incoming-share";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import type { IncomingShareDraft } from "./incoming-share-model";
import { T, Var, useGT } from "gt-react-native";

/** Parent supplies authenticated Files ports and the existing inbox. No mount effect sends. */
export function BotIncomingShare({
  share,
  destination,
  destinationLabel,
  ports,
}: {
  share: IncomingShareDraft;
  destination: BotShareDestination;
  destinationLabel: string;
  ports: BotSharePorts;
}) {
  const gt = useGT();
  const controller = useMemo(
    () => createBotShareTransfer(destination, ports),
    [destination, ports],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Binds the external transfer controller to the mounted destination; cleanup stops further network steps.
  useEffect(() => {
    controller.resume();
    return () => controller.stop();
  }, [controller]);
  const recovery = botShareRecovery(share.botTransfer, destination);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    const result = await settlePromise(action);
    if (result._tag === "Failure") {
      setError(
        gt(
          "The last action did not complete. Your share is retained; follow the recovery status below.",
        ),
      );
    }
    setBusy(false);
  };
  const phase = share.botTransfer?.phase;
  return (
    <View className="gap-3 rounded-xl bg-grouped-card p-3">
      <AppText>
        <T>
          Share with <Var>{destinationLabel}</Var>
        </T>
      </AppText>
      <AppText selectable>{share.text}</AppText>
      {share.attachments.map((a) => (
        <AppText key={a.id}>
          {a.name} · {a.sizeBytes} bytes
        </AppText>
      ))}
      {[...new Set(share.warnings)].map((warning) => (
        <AppText key={warning}>{warning}</AppText>
      ))}
      <AppText>
        <T>Staging keeps this share in your inbox. Only Send delivers it to this conversation.</T>
      </AppText>
      <AppText accessibilityLiveRegion="polite">{recovery.message}</AppText>
      {error && <AppText accessibilityRole="alert">{error}</AppText>}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={gt("Stage attachments")}
          disabled={busy || !recovery.canStage}
          onPress={() => void act(controller.stage)}
        />
        <Button
          label={gt("Send")}
          disabled={busy || !recovery.canSend}
          onPress={() => void act(controller.send)}
        />
        <Button
          label={gt("Reconcile operation")}
          disabled={busy || !recovery.canReconcile}
          onPress={() => void act(controller.reconcile)}
        />
        <Button
          label={gt("Cancel staging")}
          disabled={
            busy ||
            recovery.reason === "session-mismatch" ||
            recovery.reason === "destination-mismatch" ||
            phase === "sending" ||
            phase === "sent" ||
            (!!share.botTransfer?.pendingSourceId &&
              (!share.botTransfer?.pendingUpload || !ports.cancelUpload))
          }
          onPress={() => void act(controller.cancel)}
        />
      </View>
    </View>
  );
}
