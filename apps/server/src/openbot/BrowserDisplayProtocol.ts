import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OpenbotBrowserDisplay, OpenbotBrowserTab } from "@t3tools/contracts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const display = Schema.Struct({
  ...OpenbotBrowserDisplay.fields,
  tabs: Schema.Array(
    Schema.Union([
      OpenbotBrowserTab,
      Schema.Struct({
        ...OpenbotBrowserTab.fields,
        ownerAgentId: Schema.optional(Schema.NullOr(Schema.String)),
        ownerBotId: Schema.NullOr(Schema.String),
      }),
    ]),
  ),
});
const control = Schema.Struct({ tabIds: Schema.Array(Id) });
const pages = Schema.Struct({
  tabs: Schema.Array(
    Schema.Struct({
      tabId: Id,
      canGoBack: Schema.Boolean,
      canGoForward: Schema.Boolean,
    }),
  ),
});

// The frozen display projection omits the state supplied by the two optional capability routes.
export const project = Effect.fn("OpenbotBrowserDisplayProtocol.project")(function* (
  value: unknown,
  heldValue: unknown,
  pageValue: unknown,
) {
  const snapshot = yield* Schema.decodeUnknownEffect(display)(value);
  const held =
    heldValue === null ? { tabIds: [] } : yield* Schema.decodeUnknownEffect(control)(heldValue);
  const history =
    pageValue === null ? { tabs: [] } : yield* Schema.decodeUnknownEffect(pages)(pageValue);
  const heldIds = new Set(held.tabIds);
  const byId = new Map(history.tabs.map((tab) => [tab.tabId, tab]));
  return {
    activeTabId: snapshot.activeTabId,
    tabs: snapshot.tabs.map((tab) => {
      const ownerAgentId =
        tab.ownerAgentId !== undefined
          ? tab.ownerAgentId
          : "ownerBotId" in tab
            ? tab.ownerBotId
            : null;
      const page = byId.get(tab.id);
      return {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        ownerThreadId: tab.ownerThreadId,
        ownerAgentId,
        userControl: heldIds.has(tab.id),
        ...(page ? { canGoBack: page.canGoBack, canGoForward: page.canGoForward } : {}),
        ...(tab.recording === undefined ? {} : { recording: tab.recording }),
        ...(tab.diagnosticErrorCount === undefined
          ? {}
          : { diagnosticErrorCount: tab.diagnosticErrorCount }),
        ...(tab.popupFailure === undefined ? {} : { popupFailure: tab.popupFailure }),
        ...(tab.openerTabId === undefined ? {} : { openerTabId: tab.openerTabId }),
      };
    }),
  };
});
