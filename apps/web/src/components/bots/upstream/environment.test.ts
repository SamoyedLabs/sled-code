import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { selectWorkspaceEnvironment } from "./environment";

it("retains the selected host through an outage without switching writes to another host", () => {
  const first = { environmentId: EnvironmentId.make("first"), connection: { phase: "connected" } };
  const second = {
    environmentId: EnvironmentId.make("second"),
    connection: { phase: "connected" },
  };
  expect(selectWorkspaceEnvironment([first, second], first.environmentId)).toBe(first);
  const offline = { ...first, connection: { phase: "reconnecting" } };
  expect(selectWorkspaceEnvironment([offline, second], first.environmentId)).toBe(offline);
  expect(selectWorkspaceEnvironment([offline], null)).toBe(offline);
  expect(selectWorkspaceEnvironment([first, second], first.environmentId)).toBe(first);
  expect(selectWorkspaceEnvironment([second], first.environmentId)).toBeUndefined();
  expect(selectWorkspaceEnvironment([], first.environmentId)).toBeUndefined();
});
