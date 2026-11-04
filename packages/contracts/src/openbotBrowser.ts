import { decodeBrowserViewInput, type BrowserViewInput } from "./openbotBrowserWire.ts";
import * as Schema from "effect/Schema";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const ProfileId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60));
export const OpenbotBrowserProfileChoice = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shared") }),
  Schema.Struct({ kind: Schema.Literal("agent") }),
  Schema.Struct({ kind: Schema.Literal("profile"), profileId: ProfileId }),
]);
export const OpenbotBrowserReadRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literals(["browser.display", "browser.tabProfiles"]) }),
]);
export const OpenbotBrowserAdminRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("browser.profiles.list") }),
  Schema.Struct({ operation: Schema.Literal("browser.profiles.create"), name: Name }),
  Schema.Struct({
    operation: Schema.Literal("browser.profiles.update"),
    profileId: ProfileId,
    name: Schema.optional(Name),
    hue: Schema.optional(Schema.Literals([0, 30, 55, 100, 150, 185, 215, 245, 280, 320])),
  }),
  Schema.Struct({
    operation: Schema.Literals(["browser.profiles.delete", "browser.profiles.clear"]),
    profileId: ProfileId,
  }),
  Schema.Struct({ operation: Schema.Literal("browser.profile.clearAgent"), agentId: Id }),
  Schema.Struct({ operation: Schema.Literal("browser.profile.read"), agentId: Id }),
  Schema.Struct({
    operation: Schema.Literal("browser.profile.assign"),
    agentId: Id,
    profile: OpenbotBrowserProfileChoice,
  }),
  Schema.Struct({ operation: Schema.Literal("browser.stop"), tabId: Id }),
]);
export const OpenbotBrowserViewerGrant = Schema.Struct({
  id: Id,
  token: Schema.String,
  hostId: Id,
  tabId: Id,
  expiresAt: Schema.Number,
});
export type OpenbotBrowserViewerGrant = typeof OpenbotBrowserViewerGrant.Type;
export const OpenbotBrowserTab = Schema.Struct({
  id: Id,
  title: Schema.String,
  url: Schema.String,
  loading: Schema.Boolean,
  ownerThreadId: Schema.NullOr(Schema.String),
  ownerAgentId: Schema.NullOr(Schema.String),
  userControl: Schema.optional(Schema.Boolean),
  canGoBack: Schema.optional(Schema.Boolean),
  canGoForward: Schema.optional(Schema.Boolean),
});
export const OpenbotBrowserDisplay = Schema.Struct({
  tabs: Schema.Array(OpenbotBrowserTab),
  activeTabId: Schema.NullOr(Id),
});
export const OpenbotBrowserViewCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("open"),
    hostId: Id,
    tabId: Id,
    ackFrames: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ operation: Schema.Literal("close"), hostId: Id, id: Id }),
]);
export type OpenbotBrowserViewCommand = typeof OpenbotBrowserViewCommand.Type;

/** Private Sled viewer control; never forward release to the frozen upstream wire. */
export function decodeOpenbotBrowserViewerInput(
  text: string,
): BrowserViewInput | { type: "release" } {
  const value: unknown = JSON.parse(text);
  if (typeof value === "object" && value !== null && "type" in value && value.type === "release")
    return { type: "release" };
  return decodeBrowserViewInput(text);
}
