import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { GroupAvatar } from "./GroupAvatar";
import "~/index.css";

const fixture = vi.hoisted(() => ({
  pending: false,
  version: "v1" as string | null,
  connection: {},
  data: new Map<string, unknown>(),
}));
vi.mock("../../state/session", () => ({ readPreparedConnection: () => fixture.connection }));
vi.mock("./SourceAgentAvatar", () => ({
  useSourceAvatarHost: () => ({ environmentId: EnvironmentId.make("avatar-test"), hostId: "host" }),
}));
vi.mock("../../state/openbot", () => ({ openbot: { readFromHost: (input: unknown) => input } }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { input: { request: { operation: string } } } | null) => {
    const key = `${atom?.input.request.operation}:${fixture.version}`;
    if (!fixture.data.has(key))
      fixture.data.set(
        key,
        atom?.input.request.operation === "channel.presentation"
          ? [
              {
                channelId: "group",
                icon: null,
                imageVersion: fixture.version,
                throughSequence: 1,
                firstUnreadMessageId: null,
                firstUnreadSequence: null,
              },
            ]
          : {
              mimeType: "image/png",
              dataBase64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=",
            },
      );
    return {
      data: fixture.pending || !atom ? null : fixture.data.get(key),
      isPending: fixture.pending,
      isSuccess: !fixture.pending,
      refresh: () => {},
    };
  },
}));

it("retains a group picture during revalidation but clears it on removal or connection change", async () => {
  const avatar = () => <GroupAvatar channelId="group" members={[{ agentId: "one" }]} agents={[]} />;
  await using screen = await render(avatar());
  const image = screen.container.querySelector("img");
  expect(image).not.toBeNull();
  fixture.pending = true;
  await screen.rerender(avatar());
  expect(screen.container.querySelector("img")).toBe(image);
  fixture.connection = {};
  await screen.rerender(avatar());
  expect(screen.container.querySelector("img")).toBeNull();
  fixture.pending = false;
  await screen.rerender(avatar());
  expect(screen.container.querySelector("img")).not.toBeNull();
  fixture.version = null;
  await screen.rerender(avatar());
  expect(screen.container.querySelector("img")).toBeNull();
});
