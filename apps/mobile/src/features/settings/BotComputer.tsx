import { ComputerView } from "./ComputerView";
import { useState } from "react";
import { View } from "react-native";
import { computerChecks, computerReadiness } from "@t3tools/client-runtime/openbot/presentation";
import type { ComputerActions } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { useBotComputer } from "./useBotComputer";
import { T, Var, useGT } from "gt-react-native";

export function BotComputer({ actions }: { actions: ComputerActions }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? gt("Close computer") : gt("Computer")}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <ComputerPanel actions={actions} />}
    </View>
  );
}
function ComputerPanel({ actions }: { actions: ComputerActions }) {
  const gt = useGT();
  const computer = useBotComputer(actions);
  return (
    <View className="gap-3">
      <Text>
        <T>
          Computer access controls the host desktop and affects every connected viewer. Grant OS
          permissions on the host.
        </T>
      </Text>
      <Button
        label={gt("Refresh host capabilities")}
        disabled={computer.busy}
        onPress={computer.refresh}
      />
      <Button
        label={gt("Check host setup")}
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
            <T>
              <Var>{computer.capabilities.platform}</Var> ·{" "}
              <Var>{computer.capabilities.activeSessions}</Var> /<Var> </Var>
              <Var>{computer.capabilities.maxSessions}</Var> active sessions
            </T>
          </Text>
          <Text>
            <T>Display shared by all viewers</T>
          </Text>
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
        label={gt("Start computer viewer")}
        disabled={computer.busy || !!computer.viewer || !actions.viewer?.canOpen}
        onPress={computer.openViewer}
      />
      <Button
        label={gt("Stop my viewer")}
        disabled={computer.busy || !computer.viewer?.canClose()}
        onPress={computer.closeViewer}
      />
      {computer.viewer && (
        <ComputerView key={computer.viewer.id} id={computer.viewer.id} url={computer.viewer.url} />
      )}
    </View>
  );
}
