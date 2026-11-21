import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { WebView } from "react-native-webview";
import { Button } from "../../components/ui/Button";
import { computerInputScript } from "./computerInputScript";
import { AppText as Text } from "../../components/ui/AppText";
import { T, Var, useGT } from "gt-react-native";
export function ComputerView({ id, url }: { id: string; url: string }) {
  const gt = useGT();
  const [state, setState] = useState("connecting");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pointAndDrag" | "mouseRelative">("pointAndDrag");
  const viewer = useRef<WebView<object>>(null);
  const send = (command: Parameters<typeof computerInputScript>[1]) => {
    const target = viewer.current;
    if (!target) return;
    try {
      target.injectJavaScript(computerInputScript(id, command));
    } catch {
      setInputError(gt("This input could not be sent."));
    }
  };
  const target = new URL(url);
  const base = target.pathname.replace(/\/claim$/, "/");
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={mode === "pointAndDrag" ? gt("Tap selected") : gt("Tap")}
          disabled={state !== "connected"}
          onPress={() => {
            setMode("pointAndDrag");
            send({ kind: "mode", mode: "pointAndDrag" });
          }}
        />
        <Button
          label={mode === "mouseRelative" ? gt("Trackpad selected") : gt("Trackpad")}
          disabled={state !== "connected"}
          onPress={() => {
            setMode("mouseRelative");
            send({ kind: "mode", mode: "mouseRelative" });
          }}
        />
      </View>
      <Text>
        <T>Tap a field on the computer, then send text or a key.</T>
      </Text>
      <TextInput
        accessibilityLabel={gt("Text for focused computer field")}
        placeholder={gt("Text for focused computer field")}
        value={text}
        onChangeText={setText}
        maxLength={64}
        autoCorrect={false}
        autoCapitalize="none"
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={gt("Send computer text")}
          disabled={state !== "connected" || !text}
          onPress={() => send({ kind: "text", text })}
        />
        <Button
          label={gt("Type keys")}
          disabled={state !== "connected" || !/^[a-zA-Z0-9 ]{1,64}$/u.test(text)}
          onPress={() => send({ kind: "keys", text })}
        />
        <Button
          label={gt("Return key")}
          disabled={state !== "connected"}
          onPress={() => send({ kind: "key", key: "Enter" })}
        />
        <Button
          label={gt("Backspace key")}
          disabled={state !== "connected"}
          onPress={() => send({ kind: "key", key: "Backspace" })}
        />
      </View>
      {inputError && <Text accessibilityRole="alert">{inputError}</Text>}
      <Text accessibilityLiveRegion="polite">
        <T>
          Computer viewer: <Var>{state}</Var>
        </T>
      </Text>
      <View style={{ height: 480 }}>
        <WebView
          ref={viewer}
          source={{ uri: url }}
          originWhitelist={[target.origin]}
          javaScriptEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(request) =>
            navigationAllowed(request.url, target.origin, base)
          }
          injectedJavaScriptBeforeContentLoaded={`window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin)window.ReactNativeWebView.postMessage(JSON.stringify(e.data))});true;`}
          onMessage={(event) => {
            const next = parseState(event.nativeEvent.data, id);
            if (next) {
              setState(next);
              if (next === "connected") send({ kind: "mode", mode });
            }
            const reply = parseInputReply(event.nativeEvent.data, id);
            if (reply) {
              setInputError(
                reply.ok ? null : gt("Computer input is unavailable. Reconnect the viewer."),
              );
              if (reply.ok && (reply.kind === "text" || reply.kind === "keys")) setText("");
            }
          }}
          onError={() => setState("error")}
        />
      </View>
    </View>
  );
}

function parseInputReply(text: string, id: string) {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === "object" &&
      value !== null &&
      "source" in value &&
      value.source === "sled-computer-input" &&
      "sessionId" in value &&
      value.sessionId === id &&
      "ok" in value &&
      typeof value.ok === "boolean" &&
      "kind" in value &&
      typeof value.kind === "string"
    )
      return { ok: value.ok, kind: value.kind };
  } catch {}
  return null;
}

function navigationAllowed(value: string, origin: string, base: string) {
  try {
    const next = new URL(value);
    return next.origin === origin && next.pathname.startsWith(base);
  } catch {
    return false;
  }
}
function parseState(text: string, id: string): string | null {
  try {
    const value = JSON.parse(text);
    if (
      value !== null &&
      typeof value === "object" &&
      value.source === "openbot-moonlight" &&
      value.type === "viewer-state" &&
      value.sessionId === id &&
      ["connecting", "connected", "error"].includes(value.state)
    )
      return value.state;
    return null;
  } catch {
    return null;
  }
}
