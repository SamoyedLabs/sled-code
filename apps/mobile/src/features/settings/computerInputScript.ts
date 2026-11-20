type ComputerInput =
  | { readonly kind: "mode"; readonly mode: "pointAndDrag" | "mouseRelative" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "keys"; readonly text: string }
  | { readonly kind: "key"; readonly key: "Enter" | "Backspace" };

export function computerInputScript(sessionId: string, command: ComputerInput): string {
  if (
    command.kind === "text" &&
    (!command.text || command.text.length > 64 || /[\u0000-\u001f\u007f]/u.test(command.text))
  )
    throw new Error("Invalid computer text");
  if (command.kind === "keys" && !/^[a-zA-Z0-9 ]{1,64}$/u.test(command.text))
    throw new Error("Unsupported computer keys");
  const data = JSON.stringify({ sessionId, command }).replace(/</g, "\\u003c");
  return `(() => {
    const {sessionId, command} = ${data};
    let ok = false;
    try {
      const app = window.app;
      const input = app?.getStream?.()?.getInput?.();
      if (!input?.connected) throw new Error("Input not connected");
      if (command.kind === "mode") app.setInputConfig({touchMode: command.mode});
      else if (command.kind === "text") input.sendText(command.text);
      else if (command.kind === "keys") {
        for (const key of command.text) {
          const code = key === " " ? "Space" : /[0-9]/.test(key) ? "Digit" + key : "Key" + key.toUpperCase();
          const event = {code, key, shiftKey: /[A-Z]/.test(key), ctrlKey:false, altKey:false, metaKey:false};
          input.onKeyDown(event); input.onKeyUp(event);
        }
      }
      else {
        const event = {code: command.key, key: command.key, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false};
        input.onKeyDown(event); input.onKeyUp(event);
      }
      ok = true;
    } catch {}
    window.ReactNativeWebView?.postMessage(JSON.stringify({source:"sled-computer-input", sessionId, kind:command.kind, ok}));
  })(); true;`;
}
