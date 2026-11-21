import { expect, it } from "vite-plus/test";
import {
  botShortcutPath,
  buildBotQuickActions,
  DEFAULT_BOT_QUICK_ACTIONS,
} from "./botQuickActions";

const bot = {
  environmentId: "computer-one",
  hostId: "host-one",
  agentId: "writer",
  name: "Writer",
};
const computer = { environmentId: bot.environmentId, hostId: bot.hostId, name: "First computer" };

it("limits iOS launcher entries to four and preserves the scoped recent chat", () => {
  const actions = buildBotQuickActions(DEFAULT_BOT_QUICK_ACTIONS, [bot], computer);
  expect(actions.map(({ title }) => title)).toEqual([
    "Writer",
    "Schedule",
    "Search bots",
    "Get support",
  ]);
  expect(actions[0]?.params?.href).toBe("/bots/computer-one/host-one/writer");
  expect(actions[1]?.params?.href).toBe("/bot-schedule/computer-one/host-one");
  expect(
    buildBotQuickActions(DEFAULT_BOT_QUICK_ACTIONS, [bot], null).map(({ title }) => title),
  ).toEqual(["Get support"]);
});

it("allows own native routes and rejects arbitrary paths and nested task targets", () => {
  expect(botShortcutPath("/bots/computer-one/host-one/writer")).toBe(
    "/bots/computer-one/host-one/writer",
  );
  expect(botShortcutPath("/bots?quickAction=search")).toBe("/bots?quickAction=search");
  expect(botShortcutPath("/bot-schedule/computer-one/host-one")).toBe(
    "/bot-schedule/computer-one/host-one",
  );
  expect(botShortcutPath("/bots?quickAction=routines")).toBeNull();
  expect(botShortcutPath("/bot-schedule/computer-one")).toBeNull();
  expect(botShortcutPath("/bot-schedule/computer-one/host-one/other")).toBeNull();
  expect(botShortcutPath("/bot-schedule/computer-one/host-one/other/tasks")).toBeNull();
  expect(botShortcutPath("/bot-schedule/computer-one/%zz")).toBeNull();
  expect(botShortcutPath("/bots?quickAction=other")).toBeNull();
  expect(botShortcutPath("/bots/computer-one/host-one/writer/tasks/private")).toBeNull();
  expect(botShortcutPath("https://example.com/bots?quickAction=search")).toBeNull();
});
