import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { OpenbotBrowserDisplay, type OpenbotAdminRequest } from "@t3tools/contracts";
const displayDecoder = Schema.decodeUnknownResult(OpenbotBrowserDisplay);
export function browserDisplay(value: unknown) {
  const result = displayDecoder(value);
  return Result.isSuccess(result) ? result.success : null;
}
const profilesDecoder = Schema.decodeUnknownResult(
  Schema.Struct({
    profiles: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        hue: Schema.Number,
        tabCount: Schema.Number,
        agentIds: Schema.Array(Schema.String),
      }),
    ),
  }),
);
export function browserProfiles(value: unknown) {
  const result = profilesDecoder(value);
  return Result.isSuccess(result) ? result.success.profiles : null;
}
export function browserTabActions(
  tab: NonNullable<ReturnType<typeof browserDisplay>>["tabs"][number],
): readonly OpenbotAdminRequest[] {
  return [
    { operation: "browser.activate", tabId: tab.id },
    { operation: tab.userControl ? "browser.release" : "browser.take", tabId: tab.id },
    ...(tab.canGoBack
      ? [{ operation: "browser.navigate" as const, tabId: tab.id, direction: "back" as const }]
      : []),
    ...(tab.canGoForward
      ? [{ operation: "browser.navigate" as const, tabId: tab.id, direction: "forward" as const }]
      : []),
    { operation: tab.loading ? "browser.stop" : "browser.reload", tabId: tab.id },
    { operation: "browser.close", tabId: tab.id },
  ];
}
export function browserActionLabel(request: OpenbotAdminRequest) {
  if (request.operation === "browser.navigate")
    return request.direction === "back" ? "Back" : "Forward";
  const names: Record<string, string> = {
    "browser.activate": "Show tab",
    "browser.take": "Take control",
    "browser.release": "Return to bot",
    "browser.stop": "Stop loading",
    "browser.reload": "Reload",
    "browser.close": "Close tab",
  };
  return names[request.operation] ?? request.operation;
}
