import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { OpenBotText as Text } from "../bots/upstream/OpenBotTypography";
import { useBotPalette } from "../bots/upstream/BotChrome";
import { T, useGT } from "gt-react-native";

const schemes = ["http", "https", "socks5"] as const;
type Scheme = (typeof schemes)[number];
const Failure = Schema.NullOr(Schema.Literals(["unreachable", "signIn"]));
const Proxy = Schema.Struct({
  id: Schema.String,
  scheme: Schema.Literals(schemes),
  host: Schema.String,
  port: Schema.Int,
  username: Schema.NullOr(Schema.String),
  hasPassword: Schema.Boolean,
  profileIds: Schema.Array(Schema.String),
  failure: Failure,
});
const decode = Schema.decodeUnknownOption(
  Schema.Struct({
    proxies: Schema.Array(Proxy),
    computers: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.NullOr(Schema.String),
        online: Schema.Boolean,
        mine: Schema.Boolean,
        failure: Failure,
        profileIds: Schema.Array(Schema.String),
      }),
    ),
  }),
);
type ProxyEntry = typeof Proxy.Type;
type Scope = { environmentId: EnvironmentId; hostId: string };
type Profile = { id: string; name: string };

function proxyAddress(
  scheme: Scheme,
  host: string,
  port: string,
  username: string,
  password: string,
) {
  const parsedHost = host.trim();
  const domain = parsedHost.replace(/^\[(.*)\]$/, "$1");
  if (!domain || /[\s/?#@]/u.test(domain) || !/^\d{1,5}$/.test(port.trim())) return null;
  const portNumber = Number(port.trim());
  if (portNumber < 1 || portNumber > 65_535 || (password && !username.trim())) return null;
  const authorityHost = domain.includes(":") ? `[${domain}]` : domain;
  const signIn = username.trim()
    ? `${encodeURIComponent(username.trim())}${password ? `:${encodeURIComponent(password)}` : ""}@`
    : "";
  const result = `${scheme}://${signIn}${authorityHost}:${portNumber}`;
  try {
    return new URL(result).hostname ? result : null;
  } catch {
    return null;
  }
}

export function BotBrowserProxies({
  environmentId,
  hostId,
  profiles,
  onChanged,
}: Scope & { profiles: readonly Profile[]; onChanged: () => void }) {
  const gt = useGT();
  const p = useBotPalette();
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const compatible = settingsCapabilities(compatibility.data).includes("browser-proxies-v1");
  const canManage = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.browser-proxies.save",
        parameters: { address: "http://example.invalid:80" },
      },
    }),
  );
  const query = useEnvironmentQuery(
    compatible && canManage
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.browser-proxies.read", parameters: {} },
          },
        })
      : null,
  );
  const items = useMemo(() => Option.getOrNull(decode(query.data)), [query.data]);
  const [editing, setEditing] = useState<ProxyEntry | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  async function act(
    operation:
      | "settings.browser-proxies.save"
      | "settings.browser-proxies.delete"
      | "settings.browser-proxies.assign",
    parameters: Schema.Json,
  ) {
    if (busy || !canManage) return false;
    setBusy(true);
    setError(null);
    return (async () => {
      const result = await execute({
        environmentId,
        input: { hostId, request: { operation, parameters } },
      });
      if (result._tag !== "Success") {
        setError(gt("The proxy could not be updated. Check the address and refresh the list."));
        return false;
      }
      query.refresh();
      onChanged();
      return true;
    })()
      .catch(() => {
        setError(gt("The browser proxy request did not complete."));
        return false;
      })
      .finally(() => {
        setBusy(false);
      });
  }
  if (!compatible || !canManage) return null;

  const options = [
    ...(items?.proxies.map((entry) => ({
      id: entry.id,
      label: entry.host,
      profileIds: entry.profileIds,
    })) ?? []),
    ...(items?.computers.map((entry) => ({
      id: entry.id,
      label: entry.mine ? gt("Your computer") : (entry.name ?? gt("Computer")),
      profileIds: entry.profileIds,
    })) ?? []),
  ];
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: p.text, fontSize: 18, fontWeight: "600" }}>
        <T>Proxies</T>
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: p.text }}>
          {error}
        </Text>
      )}
      {query.error && <Button label={gt("Retry loading proxies")} onPress={query.refresh} />}
      {editing ? (
        <ProxyEditor
          key={editing === "new" ? "new" : editing.id}
          existing={editing === "new" ? null : editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (parameters) => {
            if (await act("settings.browser-proxies.save", parameters)) setEditing(null);
          }}
        />
      ) : (
        <>
          {(items?.proxies ?? []).map((entry) => (
            <Menu
              key={entry.id}
              actions={[
                { id: "edit", title: gt("Edit proxy") },
                { id: "delete", title: gt("Delete proxy"), attributes: { destructive: true } },
              ]}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "edit") setEditing(entry);
                else if (nativeEvent.event === "delete")
                  Dialog.confirm({
                    title: gt("Delete this proxy?"),
                    message: gt("Profiles using it return to Automatic. Their tabs close."),
                    confirmText: gt("Delete proxy"),
                    destructive: true,
                    onConfirm: () =>
                      void act("settings.browser-proxies.delete", {
                        proxyId: entry.id,
                        profileIds: [...entry.profileIds],
                      }),
                  });
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={gt("Proxy {host}", { host: entry.host })}
                style={{ backgroundColor: p.control, padding: 13, borderRadius: 14, gap: 4 }}
              >
                <Text style={{ color: p.text, fontWeight: "600" }}>{entry.host}</Text>
                <Text style={{ color: p.muted, fontSize: 13 }}>
                  {entry.scheme.toUpperCase()} · {entry.port} · {entry.profileIds.length} profiles
                  {entry.failure
                    ? entry.failure === "signIn"
                      ? gt(" · Sign-in refused")
                      : gt(" · Unreachable")
                    : ""}
                </Text>
              </Pressable>
            </Menu>
          ))}
          <Button label={gt("Add proxy")} disabled={busy} onPress={() => setEditing("new")} />
          {profiles.map((profile) => {
            const selected = options.find((entry) => entry.profileIds.includes(profile.id));
            return (
              <Menu
                key={profile.id}
                actions={[
                  { id: "auto", title: gt("Automatic"), state: selected ? "off" : "on" },
                  ...options.map((entry) => ({
                    id: entry.id,
                    title: entry.label,
                    state: entry.id === selected?.id ? ("on" as const) : ("off" as const),
                  })),
                ]}
                onPressAction={({ nativeEvent }) => {
                  const proxyId = nativeEvent.event === "auto" ? null : nativeEvent.event;
                  if (proxyId === (selected?.id ?? null) || busy) return;
                  Dialog.confirm({
                    title: gt("Change the profile’s proxy?"),
                    message: gt("This closes the tabs using this profile."),
                    confirmText: gt("Change proxy"),
                    onConfirm: () =>
                      void act("settings.browser-proxies.assign", {
                        profileId: profile.id,
                        proxyId,
                      }),
                  });
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={gt("Proxy for {name}", { name: profile.name })}
                  style={{ backgroundColor: p.control, padding: 13, borderRadius: 14 }}
                >
                  <Text style={{ color: p.text }}>{profile.name}</Text>
                  <Text style={{ color: p.muted, fontSize: 13 }}>
                    {selected?.label ?? gt("Automatic")}
                  </Text>
                </Pressable>
              </Menu>
            );
          })}
        </>
      )}
    </View>
  );
}

function ProxyEditor({
  existing,
  busy,
  onCancel,
  onSave,
}: {
  existing: ProxyEntry | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (parameters: Schema.Json) => Promise<void>;
}) {
  const gt = useGT();
  const p = useBotPalette();
  const [scheme, setScheme] = useState<Scheme>(existing?.scheme ?? "http");
  const [host, setHost] = useState(existing?.host ?? "");
  const [port, setPort] = useState(existing ? String(existing.port) : "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const address = proxyAddress(scheme, host, port, username, password);
  const previousAddress = existing
    ? proxyAddress(
        existing.scheme,
        existing.host,
        String(existing.port),
        existing.username ?? "",
        "",
      )
    : null;
  const field = {
    className: "rounded-xl bg-control px-3 py-3 text-foreground",
    autoCorrect: false,
    autoCapitalize: "none" as const,
    autoComplete: "off" as const,
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: p.text, fontWeight: "600" }}>
        {existing ? gt("Edit proxy") : gt("Add proxy")}
      </Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {schemes.map((item) => (
          <Button
            key={item}
            label={item.toUpperCase()}
            tone={scheme === item ? "primary" : "text"}
            onPress={() => setScheme(item)}
          />
        ))}
      </View>
      <AppTextInput
        {...field}
        accessibilityLabel={gt("Proxy host")}
        placeholder={gt("Host")}
        value={host}
        maxLength={255}
        onChangeText={setHost}
      />
      <AppTextInput
        {...field}
        accessibilityLabel={gt("Proxy port")}
        placeholder={gt("Port")}
        value={port}
        keyboardType="number-pad"
        maxLength={5}
        onChangeText={setPort}
      />
      <AppTextInput
        {...field}
        accessibilityLabel={gt("Proxy username")}
        placeholder={gt("Username (optional)")}
        value={username}
        onChangeText={setUsername}
      />
      <AppTextInput
        {...field}
        accessibilityLabel={gt("Proxy password")}
        placeholder={existing?.hasPassword ? gt("Password saved") : gt("Password (optional)")}
        secureTextEntry
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button label={gt("Cancel")} tone="text" disabled={busy} onPress={onCancel} />
        <Button
          label={gt("Save proxy")}
          disabled={busy || !address || (!!existing && !previousAddress)}
          onPress={() => {
            if (!address) return;
            void onSave({
              address,
              ...(existing && previousAddress
                ? {
                    proxyId: existing.id,
                    previousAddress,
                    keepPassword: existing.hasPassword && !password,
                  }
                : {}),
            });
          }}
        />
      </View>
    </View>
  );
}
