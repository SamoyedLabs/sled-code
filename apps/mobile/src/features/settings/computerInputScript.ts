import { m } from "../../i18n/messages";
import { msg } from "gt-react-native";
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
  return m(
    msg(
      "(() => '{'\n    const '{'sessionId, command'}' = {data};\n    let ok = false;\n    try '{'\n      const app = window.app;\n      const input = app?.getStream?.()?.getInput?.();\n      if (!input?.connected) throw new Error(\"Input not connected\");\n      if (command.kind === \"mode\") app.setInputConfig('{'touchMode: command.mode'}');\n      else if (command.kind === \"text\") input.sendText(command.text);\n      else if (command.kind === \"keys\") '{'\n        for (const key of command.text) '{'\n          const code = key === \" \" ? \"Space\" : /[0-9]/.test(key) ? \"Digit\" + key : \"Key\" + key.toUpperCase();\n          const event = '{'code, key, shiftKey: /[A-Z]/.test(key), ctrlKey:false, altKey:false, metaKey:false'}';\n          input.onKeyDown(event); input.onKeyUp(event);\n        '}'\n      '}'\n      else '{'\n        const event = '{'code: command.key, key: command.key, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false'}';\n        input.onKeyDown(event); input.onKeyUp(event);\n      '}'\n      ok = true;\n    '}' catch '{''}'\n    window.ReactNativeWebView?.postMessage(JSON.stringify('{'source:\"sled-computer-input\", sessionId, kind:command.kind, ok'}'));\n  '}')(); true;",
      { data },
    ),
  );
}
