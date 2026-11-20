import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { project } from "./BrowserDisplayProtocol.ts";

it.effect(
  "joins actual optional browser control and navigation state to frozen tabs by identity",
  () =>
    Effect.gen(function* () {
      const value = {
        tabs: [
          {
            id: "owned",
            title: "Owned",
            url: "http://127.0.0.1/",
            loading: false,
            recording: true,
            diagnosticErrorCount: 2,
            popupFailure: { id: "popup", message: "Popup blocked" },
            openerTabId: "parent",
            ownerThreadId: null,
            ownerBotId: "agent",
          },
        ],
        activeTabId: "owned",
      };
      const result = yield* project(
        value,
        { tabIds: ["owned", "other"] },
        {
          tabs: [
            { tabId: "other", canGoBack: false, canGoForward: true },
            { tabId: "owned", canGoBack: true, canGoForward: false },
          ],
        },
      );
      expect(result.tabs).toEqual([
        {
          id: "owned",
          title: "Owned",
          url: "http://127.0.0.1/",
          loading: false,
          recording: true,
          diagnosticErrorCount: 2,
          popupFailure: { id: "popup", message: "Popup blocked" },
          openerTabId: "parent",
          ownerThreadId: null,
          ownerAgentId: "agent",
          userControl: true,
          canGoBack: true,
          canGoForward: false,
        },
      ]);
      expect((yield* project(value, { tabIds: [] }, { tabs: [] })).tabs[0]).toMatchObject({
        userControl: false,
      });
      expect((yield* project(value, null, null)).tabs[0]?.userControl).toBe(false);
      expect((yield* project(value, null, null)).tabs[0]).not.toHaveProperty("canGoBack");
      expect((yield* Effect.result(project(value, { tabIds: [42] }, { tabs: [] })))._tag).toBe(
        "Failure",
      );
    }),
);
