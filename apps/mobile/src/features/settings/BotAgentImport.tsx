import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { IMPORT_INSTRUCTIONS } from "@t3tools/client-runtime/openbot/agent-import";
import { useState, useSyncExternalStore } from "react";
import { View, Pressable } from "react-native";
import type { AgentImportController } from "@t3tools/client-runtime/openbot/agent-import";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
export function BotAgentImport({
  controller: c,
  destination,
  chooseArchive,
}: {
  controller: AgentImportController;
  destination: string;
  chooseArchive: () => Promise<{
    name: string;
    size: number;
    source: unknown;
    requestId: string;
  } | null>;
}) {
  const s = useSyncExternalStore(c.subscribe, c.snapshot, c.snapshot);
  const [instructionId, setInstructionId] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState("");
  const [sharing, setSharing] = useState(false);
  async function saveInstruction(instruction: (typeof IMPORT_INSTRUCTIONS)[number]) {
    if (sharing) return;
    setSharing(true);
    setShareNotice("");
    const file = new File(Paths.cache, `${Crypto.randomUUID()}-${instruction.name}`);
    await (async () => {
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
      file.create({ overwrite: true });
      file.write(instruction.text);
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/markdown",
        dialogTitle: `Save ${instruction.label} export instructions`,
      });
    })()
      .catch(() => {
        setShareNotice("Could not open sharing. You can read the instructions below.");
      })
      .finally(() => {
        try {
          if (file.exists) file.delete();
        } catch {
          /* The OS may still hold the shared cache file. */
        }
        setSharing(false);
      });
  }
  const locked = s.busy || s.uncertain || s.receipt?.state !== "staged";
  return (
    <View className="gap-3 p-3">
      <Text accessibilityRole="header">Import agents</Text>
      <Text>
        Prepare an export with the upstream instructions. Sled uploads the ZIP to the destination
        host; keep it within 100 MiB.
      </Text>
      {IMPORT_INSTRUCTIONS.map((instruction) => (
        <View key={instruction.id} className="gap-2">
          <Button
            label={`Read ${instruction.label} export instructions`}
            onPress={() =>
              setInstructionId(instructionId === instruction.id ? null : instruction.id)
            }
          />
          <Button
            label={`Save ${instruction.label} instructions`}
            disabled={sharing}
            onPress={() => void saveInstruction(instruction)}
          />
          {instructionId === instruction.id && <Text selectable>{instruction.text}</Text>}
        </View>
      ))}
      {!!shareNotice && <Text accessibilityLiveRegion="polite">{shareNotice}</Text>}
      <Text>
        Destination: {destination}. Creates new agents. Accounts and provider credentials are not
        imported.
      </Text>
      <Button label="Recover / refresh import" disabled={s.busy} onPress={() => void c.refresh()} />
      <Button
        label="Choose ZIP (up to 100 MiB)"
        disabled={s.busy || s.uncertain || (!!s.receipt && s.receipt.state !== "discarded")}
        onPress={() => {
          void chooseArchive()
            .then((file) => {
              if (file) return c.stage(file, file.requestId);
            })
            .catch(() => undefined);
        }}
      />
      {s.receipt && (
        <>
          <Text>
            Status: {s.receipt.state} · Source: {s.receipt.preview.sourceApp}
          </Text>
          <Text accessibilityRole="header">Choose agents</Text>
          {s.receipt.preview.agents.map((agent) => (
            <Pressable
              key={agent.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: s.keys.includes(agent.key), disabled: locked }}
              disabled={locked}
              className="min-h-12 py-3"
              onPress={() => c.select("keys", agent.key)}
            >
              <Text>
                {s.keys.includes(agent.key) ? "✓ " : "○ "}
                {agent.name}
                {agent.nameExists ? " (name already exists)" : ""}
              </Text>
              <Text>{agent.description}</Text>
              <Text>
                {agent.skillCount} skills · {agent.routineCount} routines · {agent.memoryCount}{" "}
                memories · {agent.fileCount} files
              </Text>
            </Pressable>
          ))}
          <Text accessibilityRole="header">Choose group chats</Text>
          {s.receipt.preview.channels.map((channel) => (
            <Pressable
              key={channel.key}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: s.channelKeys.includes(channel.key),
                disabled: locked,
              }}
              disabled={locked}
              className="min-h-12 py-3"
              onPress={() => c.select("channelKeys", channel.key)}
            >
              <Text>
                {s.channelKeys.includes(channel.key) ? "✓ " : "○ "}
                {channel.name}: members {channel.memberKeys.join(", ")}
              </Text>
            </Pressable>
          ))}
          {s.receipt.preview.warnings.map((warning) => (
            <Text key={warning}>{warning}</Text>
          ))}
          <Text>
            Choose at least one agent. Selected chats use only agents that successfully import.
          </Text>
          <Button
            label={`Import selected into ${destination}`}
            disabled={locked || !s.keys.length}
            onPress={() => void c.apply(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          />
          <Button
            label={s.receipt.state === "complete" ? "Dismiss result" : "Discard archive"}
            disabled={s.busy || s.uncertain || !["staged", "complete"].includes(s.receipt.state)}
            onPress={() => void c.discard()}
          />
          {s.receipt.result && (
            <>
              <Text>
                Imported: {s.receipt.result.agents.map((a) => a.name).join(", ")}; channels:{" "}
                {s.receipt.result.channels.map((a) => a.name).join(", ")}
              </Text>
              {[...s.receipt.result.skipped, ...s.receipt.result.skippedChannels].map((item) => (
                <Text key={item.key}>
                  {item.name}: {item.reason}
                </Text>
              ))}
              {s.receipt.result.warnings.map((warning) => (
                <Text key={warning}>{warning}</Text>
              ))}
            </>
          )}
        </>
      )}
      <Text accessibilityLiveRegion="polite">{s.notice}</Text>
    </View>
  );
}
