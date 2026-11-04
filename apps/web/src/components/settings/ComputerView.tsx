/* oxlint-disable react/iframe-missing-sandbox -- Moonlight needs script execution and its origin for HTTP and signaling. */
import { useEffect, useRef, useState } from "react";
export function ComputerView({ id, url }: { id: string; url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState("connecting");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe to the Moonlight frame's first-pixel and failure reports.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(url).origin)
        return;
      const value = event.data;
      if (
        value?.source === "openbot-moonlight" &&
        value.type === "viewer-state" &&
        value.sessionId === id &&
        ["connecting", "connected", "error"].includes(value.state)
      )
        setState(value.state);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [id, url]);
  return (
    <div className="space-y-2">
      <p role="status">Computer viewer: {state}</p>
      <iframe
        ref={frame}
        title="Host computer viewer"
        src={url}
        className="h-[60vh] w-full"
        sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock"
        allow="fullscreen; keyboard-map"
        referrerPolicy="no-referrer"
        onError={() => setState("error")}
      />
    </div>
  );
}
