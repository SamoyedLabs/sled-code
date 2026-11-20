import { WebView } from "react-native-webview";
import { chatHtmlPreviewDocument } from "./chat-preview";

const attribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const OPEN_LINK_SCRIPT = `const frame=document.querySelector('iframe');frame.addEventListener('load',()=>{const page=frame.contentDocument;if(!page)return;page.addEventListener('click',(event)=>{if(!event.isTrusted)return;const link=event.target.closest?.('a,area');if(!link)return;event.preventDefault();const href=link.getAttribute('href')??'';if(href.startsWith('#')){try{page.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();}catch{}return;}if(/^https?:\\/\\//i.test(href))window.ReactNativeWebView.postMessage(href);});});`;

export default function HtmlPreview({
  source,
  title,
  card = false,
  onOpenLink,
}: {
  source: string;
  title: string;
  card?: boolean;
  onOpenLink?: (url: string) => Promise<void>;
}) {
  const child = attribute(chatHtmlPreviewDocument(source));
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-src 'self' about:; form-action 'none'; base-uri 'none'">
    <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:white}
    ${card ? "body{overflow:hidden}iframe{pointer-events:none}" : ""}</style>
    </head><body><iframe title="${attribute(title)}" sandbox="${card ? "" : "allow-same-origin"}" referrerpolicy="no-referrer" srcdoc="${child}"></iframe>${card ? "" : `<script>${OPEN_LINK_SCRIPT}</script>`}</body></html>`;
  return (
    <WebView
      source={{ html }}
      accessibilityLabel={title}
      style={{ flex: 1, backgroundColor: "white" }}
      originWhitelist={["*"]}
      javaScriptEnabled={!card}
      scrollEnabled={!card}
      contentInsetAdjustmentBehavior="never"
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={({ url }) =>
        url === "about:blank" || url === "about:srcdoc" || url.startsWith("about:srcdoc#")
      }
      {...(!card && onOpenLink
        ? {
            onMessage: ({
              nativeEvent,
            }: import("react-native-webview").WebViewMessageEvent): void => {
              if (/^https?:\/\//i.test(nativeEvent.data)) void onOpenLink(nativeEvent.data);
            },
          }
        : {})}
    />
  );
}
