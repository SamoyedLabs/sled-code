import { ComputerView } from "./ComputerView";
import { useState } from "react";
import { View } from "react-native";
import { computerChecks, computerReadiness } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { useBotComputer } from "./useBotComputer";

export function BotComputer({ actions }: { actions: ComputerActions }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close computer" : "Computer"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <ComputerPanel actions={actions} />}
    </View>
  );
}
function ComputerPanel({ actions }: { actions: ComputerActions }) {
  const computer = useBotComputer(actions);
  return (
    <View className="gap-3">
      <Text>
        Computer access controls the host desktop and affects every connected viewer. Grant OS
        permissions on the host.
      </Text>
      <Button
        label="Refresh host capabilities"
        disabled={computer.busy}
        onPress={computer.refresh}
      />
      <Button
        label="Check host setup"
        disabled={computer.busy || !actions.canCheckSetup}
        onPress={computer.checkSetup}
      />
      {computer.error && <Text accessibilityRole="alert">{computer.error}</Text>}
      <Text accessibilityLiveRegion="polite">
        {computerReadiness(computer.capabilities, computer.setup)}
      </Text>
      {computer.setup &&
        computerChecks.map(([key, label]) => (
          <Text key={key}>
            {label}: {computer.setup?.[key]}
          </Text>
        ))}
      {computer.capabilities && (
        <>
          <Text>
            {computer.capabilities.platform} · {computer.capabilities.activeSessions} /{" "}
            {computer.capabilities.maxSessions} active sessions
          </Text>
          <Text>Display shared by all viewers</Text>
          {computer.capabilities.displays.map((display) => (
            <Button
              key={display.id}
              label={`${display.id === computer.capabilities?.selectedDisplayId ? "Selected: " : ""}${display.label} (${display.width} × ${display.height})`}
              disabled={computer.busy || !actions.canSelectDisplay(display.id)}
              onPress={() => computer.selectDisplay(display.id)}
            />
          ))}
        </>
      )}
      <Button
        label="Start computer viewer"
        disabled={computer.busy || !!computer.viewer || !actions.viewer?.canOpen}
        onPress={computer.openViewer}
      />
      <Button
        label="Stop my viewer"
        disabled={computer.busy || !computer.viewer?.canClose()}
        onPress={computer.closeViewer}
      />
      {computer.viewer && (
        <ComputerView key={computer.viewer.id} id={computer.viewer.id} url={computer.viewer.url} />
      )}
    </View>
  );
}
