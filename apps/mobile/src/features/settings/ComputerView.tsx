import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { AppText as Text } from "../../components/ui/AppText";
export function ComputerView({ id, url }: { id: string; url: string }) {
  const [state, setState] = useState("connecting");
  const target = new URL(url);
  const base = target.pathname.replace(/\/claim$/, "/");
  return (
    <View style={{ height: 480 }}>
      <Text accessibilityLiveRegion="polite">Computer viewer: {state}</Text>
      <WebView
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
          if (next) setState(next);
        }}
        onError={() => setState("error")}
      />
    </View>
  );
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
      value.source === "openbot-moonlight" &&
      value.type === "viewer-state" &&
      value.sessionId === id &&
      ["connecting", "connected", "error"].includes(value.state)
    )
      return value.state;
    return null;
  } catch {
    return "error";
  }
}
