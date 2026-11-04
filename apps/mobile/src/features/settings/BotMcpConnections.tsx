import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { useState } from "react";
import type { OpenbotAdminRequest } from "@t3tools/contracts";
import {
  botMcpRequest,
  botMcpPatchRequest,
  EMPTY_BOT_MCP_DRAFT,
  type BotMcpDraft,
} from "@t3tools/client-runtime/openbot/presentation";
import { AppTextInput } from "../../components/ui/AppText";
import { confirm, Picker } from "./BotConnectionControls";

export function McpPanel({ controller: { state, run, busy, setError }, allowed }: PanelProps) {
  const [draft, setDraft] = useState<BotMcpDraft | null>(null);
  const [editing, setEditing] = useState<{ id: string; patch: string } | null>(null);
  const [visible, setVisible] = useState(20);
  const savePatch = async () => {
    if (!editing) return;
    const request = botMcpPatchRequest(editing.id, editing.patch);
    if (!request) {
      setError("Enter a JSON object containing MCP configuration fields to replace.");
      return;
    }
    setEditing(null);
    await run([request]);
  };
  const update = (key: keyof BotMcpDraft, value: string) => {
    if (draft && key !== "transport") setDraft({ ...draft, [key]: value });
  };
  const save = async (test: boolean) => {
    if (!draft) return;
    const request = botMcpRequest(draft);
    if (!request || request.operation !== "mcp.save") {
      setError(
        "Enter a name and address or command, a JSON argument array, and JSON objects for environment variables and headers.",
      );
      return;
    }
    setDraft(null);
    await run(test ? [{ operation: "mcp.test", config: request.config }] : [request]);
  };
  const remove = (id: string) =>
    confirm("Delete this MCP server connection? Its saved configuration will be removed.", () => {
      const requests: OpenbotAdminRequest[] =
        state.activeMcpId === id ? [{ operation: "mcp.signIn.cancelById", mcpServerId: id }] : [];
      void run([...requests, { operation: "mcp.delete", mcpServerId: id }]);
    });
  return (
    <View className="gap-3">
      <Text className="text-foreground-muted">
        Connect tools on this host. Saved credentials stay on the host.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Load MCP servers"
          disabled={!allowed || busy}
          onPress={() => void run([{ operation: "mcp.list" }, { operation: "mcp.signIn.list" }])}
        />
        <Button
          label="Add MCP server"
          disabled={!allowed || busy}
          onPress={() => setDraft({ ...EMPTY_BOT_MCP_DRAFT })}
        />
      </View>
      {state.mcps?.length === 0 && (
        <Text className="text-foreground-muted">No MCP servers connected.</Text>
      )}
      {state.mcps?.slice(0, visible).map((row) => (
        <View key={row.id} className="gap-2 border-t border-border pt-3">
          <Text className="font-t3-medium">
            {row.name} · {row.enabled ? "Enabled" : "Disabled"}
          </Text>
          <Text className="text-foreground-muted">
            {row.transport === "http" ? row.url : "Command on this host"}
            {state.signIns?.find((signIn) => signIn.mcpServerId === row.id)?.signedIn
              ? " · Signed in"
              : ""}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Edit configuration"
              disabled={!allowed || busy}
              onPress={() => setEditing({ id: row.id, patch: "{}" })}
            />
            <Button
              label={row.enabled ? "Disable" : "Enable"}
              disabled={!allowed || busy}
              onPress={() =>
                void run([{ operation: "mcp.toggle", mcpServerId: row.id, enabled: !row.enabled }])
              }
            />
            <Button
              label="Test connection"
              disabled={!allowed || busy}
              onPress={() => void run([{ operation: "mcp.testById", mcpServerId: row.id }])}
            />
            {row.transport === "http" && (
              <>
                <Button
                  label="Sign in on host"
                  disabled={!allowed || busy}
                  onPress={() =>
                    void run([{ operation: "mcp.signIn.startById", mcpServerId: row.id }])
                  }
                />
                <Button
                  label="Check sign-in"
                  disabled={!allowed || busy}
                  onPress={() =>
                    void run([
                      { operation: "mcp.signIn.statusById", mcpServerId: row.id },
                      { operation: "mcp.signIn.list" },
                    ])
                  }
                />
                <Button
                  label="Sign out"
                  disabled={!allowed || busy}
                  onPress={() => void run([{ operation: "mcp.signOut", mcpServerId: row.id }])}
                />
              </>
            )}
            {state.activeMcpId === row.id && (
              <Button
                label="Cancel sign-in"
                disabled={!allowed || busy}
                onPress={() =>
                  void run([{ operation: "mcp.signIn.cancelById", mcpServerId: row.id }])
                }
              />
            )}
            <Button
              label="Delete"
              tone="danger"
              disabled={!allowed || busy}
              onPress={() => remove(row.id)}
            />
          </View>
        </View>
      ))}
      {state.mcps && state.mcps.length > visible && (
        <Button label="Show more MCP servers" onPress={() => setVisible(visible + 20)} />
      )}
      {editing && (
        <View className="gap-2 border-t border-border pt-3">
          <Text>Configuration changes (JSON object)</Text>
          <AppTextInput
            accessibilityLabel="MCP configuration changes"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={editing.patch}
            editable={!busy && allowed}
            onChangeText={(value) => setEditing({ ...editing, patch: value })}
          />
          <Text textRole="footnote" className="text-foreground-muted">
            Omitted fields keep their saved values. Use an empty array to clear headers or
            environment variables. Changes clear after submission.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Save changes"
              disabled={!allowed || busy}
              onPress={() => void savePatch()}
            />
            <Button label="Cancel changes" disabled={busy} onPress={() => setEditing(null)} />
          </View>
        </View>
      )}
      {draft && (
        <View className="gap-3 border-t border-border pt-3">
          <Text>Name</Text>
          <AppTextInput
            accessibilityLabel="MCP server name"
            value={draft.name}
            editable={!busy && allowed}
            onChangeText={(value) => update("name", value)}
          />
          <Picker
            label="Transport"
            value={draft.transport}
            options={[
              { id: "http", name: "HTTP" },
              { id: "stdio", name: "Command (stdio)" },
            ]}
            disabled={busy || !allowed}
            onChange={(value) => {
              if (value === "http" || value === "stdio") setDraft({ ...draft, transport: value });
            }}
          />
          {(draft.transport === "http"
            ? (["url", "headers"] as const)
            : (["command", "args", "env", "workingDirectory"] as const)
          ).map((key) => (
            <View key={key} className="gap-2">
              <Text>
                {
                  {
                    url: "Server URL",
                    headers: "Headers (JSON object)",
                    command: "Command",
                    args: "Arguments (JSON array)",
                    env: "Environment variables (JSON object)",
                    workingDirectory: "Working directory",
                  }[key]
                }
              </Text>
              <AppTextInput
                accessibilityLabel={`MCP ${key}`}
                secureTextEntry={key === "env" || key === "headers"}
                autoCapitalize="none"
                autoCorrect={false}
                value={draft[key]}
                editable={!busy && allowed}
                onChangeText={(value) => update(key, value)}
              />
            </View>
          ))}
          <Text textRole="footnote" className="text-foreground-muted">
            Arguments are literal JSON strings. Private fields clear after testing, saving or
            cancelling.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Save MCP server"
              disabled={busy || !allowed}
              onPress={() => void save(false)}
            />
            <Button
              label="Test draft"
              disabled={busy || !allowed}
              onPress={() => void save(true)}
            />
            <Button label="Cancel" disabled={busy} onPress={() => setDraft(null)} />
          </View>
        </View>
      )}
    </View>
  );
}
