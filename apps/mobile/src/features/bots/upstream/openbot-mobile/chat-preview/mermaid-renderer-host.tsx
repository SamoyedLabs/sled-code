import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import pageAsset from "@t3tools/mobile-mermaid-page";
import { receiveMermaidResult, useMermaidJobs } from "./mermaid-diagrams";
import type { MermaidJob } from "./mermaid-diagrams";

let page: Promise<string> | null = null;
function loadPage() {
  page ??= Asset.fromModule(pageAsset)
    .downloadAsync()
    .then(({ localUri }) => {
      if (!localUri) throw new Error("Mermaid renderer is unavailable.");
      return new File(localUri).text();
    })
    .catch((error: unknown) => {
      page = null;
      throw error;
    });
  return page;
}

const failJob = ({ id }: MermaidJob) =>
  receiveMermaidResult({ id, svgUrl: null, pngUrl: null, width: 0, height: 0 });

/** One isolated WebView renders diagrams for the chat cards and fullscreen viewer. */
export function MermaidRendererHost() {
  const jobs = useMermaidJobs();
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const web = useRef<WebView<object>>(null);
  const inFlight = useRef<string | null>(null);
  const next = jobs[0];

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Loads the packaged renderer on its first native request.
  useEffect(() => {
    if (!next || html || failed) return;
    let mounted = true;
    void loadPage().then(
      (source) => {
        if (mounted) setHtml(source);
      },
      () => {
        if (mounted) setFailed(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, [failed, html, next]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Delivers one bounded job to the trusted native WebView; an unresponsive renderer is retired.
  useEffect(() => {
    if (!next) return;
    if (failed) {
      failJob(next);
      return;
    }
    if (!ready || !web.current || inFlight.current === next.id) return;
    inFlight.current = next.id;
    web.current.injectJavaScript(`window.sledMermaidDraw(${JSON.stringify(next)});true;`);
    const timeout = setTimeout(() => setFailed(true), 12_000);
    return () => clearTimeout(timeout);
  }, [failed, next, ready]);

  if (!html || failed) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
    >
      <WebView<object>
        ref={web}
        source={{ html }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={({ url }) => url === "about:blank"}
        onLoadEnd={() => setReady(true)}
        onError={() => setFailed(true)}
        onContentProcessDidTerminate={() => setFailed(true)}
        scrollEnabled={false}
        onMessage={({ nativeEvent }) => {
          const raw = nativeEvent.data;
          if (!raw || raw.length > 4_500_000) return;
          let result: {
            id?: unknown;
            width?: unknown;
            height?: unknown;
            svgUrl?: unknown;
            pngUrl?: unknown;
          } | null = null;
          try {
            result = JSON.parse(raw);
          } catch {
            setFailed(true);
            return;
          }
          if (
            typeof result !== "object" ||
            result === null ||
            typeof result.id !== "string" ||
            result.id !== inFlight.current ||
            typeof result.width !== "number" ||
            !Number.isFinite(result.width) ||
            typeof result.height !== "number" ||
            !Number.isFinite(result.height)
          )
            return;
          const svgUrl = result.svgUrl;
          const pngUrl = result.pngUrl;
          if (
            (svgUrl !== null &&
              (typeof svgUrl !== "string" || !svgUrl.startsWith("data:image/svg+xml;"))) ||
            (pngUrl !== null &&
              (typeof pngUrl !== "string" || !pngUrl.startsWith("data:image/png;base64,")))
          )
            return;
          inFlight.current = null;
          try {
            receiveMermaidResult({
              id: result.id,
              width: result.width,
              height: result.height,
              svgUrl,
              pngUrl,
            });
          } catch {
            setFailed(true);
          }
        }}
      />
    </View>
  );
}
